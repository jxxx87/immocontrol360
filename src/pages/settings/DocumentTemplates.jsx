import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Mention from '@tiptap/extension-mention';
import Image from '@tiptap/extension-image';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import { 
    Bold, Italic, Underline as UnderlineIcon, 
    AlignLeft, AlignCenter, AlignRight, AlignJustify,
    List, ListOrdered, Undo, Redo, 
    Save, RotateCcw, FileText, ChevronLeft, ChevronRight, 
    HelpCircle, Image as ImageIcon, Plus, Trash2, Folder, Loader2,
    ArrowLeft, ArrowRight, Minus, Strikethrough
} from 'lucide-react';

// Deutsche Variablen für globale Verwendung
const GLOBAL_VARIABLES = [
    { id: 'mieter_name', label: 'Mieter Name', icon: '👤' },
    { id: 'mieter_anrede', label: 'Sehr geehrte/r ...', icon: '✉️' },
    { id: 'mieter_adresse', label: 'Mieter Adresse', icon: '🏠' },
    { id: 'objekt_name', label: 'Objektname', icon: '🏢' },
    { id: 'einheit_name', label: 'Wohneinheit', icon: '🚪' },
    { id: 'objekt_adresse', label: 'Objekt-Adresse', icon: '📍' },
    { id: 'vermieter_name', label: 'Vermieter Name', icon: '👤' },
    { id: 'vermieter_bankverbindung', label: 'Vermieter Bankverbindung', icon: '💳' }
];

// Deutsche Variablen für das Mahnwesen
const DUNNING_VARIABLES = [
    ...GLOBAL_VARIABLES,
    { id: 'offener_betrag', label: 'Offener Betrag', icon: '💰' },
    { id: 'zahlungsfrist_datum', label: 'Fälligkeitsdatum', icon: '📅' },
    { id: 'verzugstage', label: 'Verzugstage', icon: '⏱️' },
    { id: 'mahnstufe', label: 'Mahnstufe', icon: '📈' },
    { id: 'zinsbetrag', label: 'Verzugszinsen', icon: '💸' },
    { id: 'forderungs_tabelle', label: 'Forderungstabelle', icon: '📊' }
];

// Deutsche Variablen für Nebenkosten
const UTILITY_VARIABLES = [
    ...GLOBAL_VARIABLES,
    { id: 'abrechnungsjahr', label: 'Abrechnungsjahr', icon: '📅' },
    { id: 'abrechnungszeitraum', label: 'Abrechnungszeitraum', icon: '📆' },
    { id: 'nutzungszeitraum', label: 'Nutzungszeitraum', icon: '⏳' },
    { id: 'gesamtkosten_mieter', label: 'Gesamtkosten Mieter', icon: '💰' },
    { id: 'vorauszahlungs_betrag', label: 'Geleistete Vorauszahlung', icon: '📥' },
    { id: 'saldo_betrag', label: 'Saldo (Ergebnis)', icon: '💵' },
    { id: 'saldo_art', label: 'Saldo Art (Nachzahlung/Gutschrift)', icon: '📝' },
    { id: 'nebenkosten_tabelle', label: 'Umlagetabelle', icon: '📊' }
];

// Deutsche Variablen für Fewo-Rechnungen
const INVOICE_VARIABLES = [
    { id: 'gast_name', label: 'Gast Name', icon: '👤' },
    { id: 'gast_adresse', label: 'Gast Adresse', icon: '🏠' },
    { id: 'buchungszeitraum', label: 'Leistungszeitraum', icon: '📅' },
    { id: 'gaeste_anzahl', label: 'Anzahl Gäste', icon: '👥' },
    { id: 'rechnungsnummer', label: 'Rechnungsnummer', icon: '🔢' },
    { id: 'rechnungsdatum', label: 'Rechnungsdatum', icon: '📆' },
    { id: 'netto_betrag', label: 'Netto-Betrag', icon: '💰' },
    { id: 'mwst_betrag', label: 'MwSt-Betrag (7%)', icon: '💸' },
    { id: 'brutto_betrag', label: 'Gesamtbetrag (Brutto)', icon: '💵' },
    { id: 'original_rechnungsnummer', label: 'Ref-Rechnungsnummer', icon: '📎' },
    { id: 'positions_tabelle', label: 'Rechnungspositionen-Tabelle', icon: '📊' },
    { id: 'vermieter_name', label: 'Vermieter Name', icon: '👤' },
    { id: 'vermieter_bankverbindung', label: 'Vermieter Bankverbindung', icon: '💳' },
    { id: 'vermieter_steuernummer', label: 'Vermieter Steuernummer', icon: '📝' },
    { id: 'vermieter_ust_id', label: 'Vermieter USt-IdNr.', icon: '🆔' }
];

// Deutsche Variablen für Mieterhöhungen
const RENT_INCREASE_VARIABLES = [
    ...GLOBAL_VARIABLES,
    { id: 'aktuelle_miete', label: 'Aktuelle Miete', icon: '💵' },
    { id: 'neue_miete', label: 'Neue Miete', icon: '📈' },
    { id: 'erhoehungs_betrag', label: 'Erhöhungsbetrag', icon: '💰' },
    { id: 'erhoehungs_datum', label: 'Wirksamkeitsdatum', icon: '📅' },
    { id: 'zustimmungs_frist', label: 'Zustimmungsfrist', icon: '⏱️' }
];

// Deutsche Variablen für sonstige Bescheinigungen
const CERTIFICATE_VARIABLES = [
    ...GLOBAL_VARIABLES,
    { id: 'einzug_datum', label: 'Einzugsdatum', icon: '📅' }
];

const DEFAULT_TEMPLATES = {
    payment_reminder: {
        name: 'Zahlungserinnerung',
        category: 'Mahnwesen',
        subject: 'Zahlungserinnerung zu offenen Mietforderungen',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Zahlungserinnerung zu offenen Mietforderungen</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Bezüglich der offenen Posten besteht aktuell ein Zahlungsrückstand.</p><p>Trotz Fälligkeit wurde die nachfolgend aufgeführte Forderung nicht vollständig ausgeglichen. Bitte prüfen Sie den Vorgang und gleichen Sie den offenen Betrag aus.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    dunning_1: {
        name: 'Mahnung (Stufe 1)',
        category: 'Mahnwesen',
        subject: 'Mahnung wegen Mietrückstand',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Mahnung wegen Mietrückstand</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    dunning_2: {
        name: 'Abmahnung (Stufe 2)',
        category: 'Mahnwesen',
        subject: 'Abmahnung und Zahlungsaufforderung wegen Zahlungsverzug',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Abmahnung und Zahlungsaufforderung wegen Zahlungsverzug</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Aufgrund der Höhe des Rückstands kann zudem die Prüfung einer außerordentlichen fristlosen Kündigung gemäß § 543 Abs. 2 Nr. 3 BGB, hilfsweise einer ordentlichen Kündigung, in Betracht kommen. Für Wohnraummietverhältnisse sind zusätzlich die Regelungen des § 569 BGB zu beachten.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    dunning_final: {
        name: 'Letzte Zahlungsaufforderung',
        category: 'Mahnwesen',
        subject: 'Letzte Zahlungsaufforderung vor weiteren Schritten',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Letzte Zahlungsaufforderung vor weiteren Schritten</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    utility_costs: {
        name: 'Nebenkostenabrechnung',
        category: 'Nebenkosten',
        subject: 'Betriebskostenabrechnung für das Abrechnungsjahr',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Betriebskostenabrechnung für das Abrechnungsjahr <span data-type="mention" data-id="abrechnungsjahr" data-label="Abrechnungsjahr">Abrechnungsjahr</span></div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>anbei erhalten Sie die ordnungsgemäße Betriebskostenabrechnung für Ihr Mietobjekt <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>) für das Abrechnungsjahr <strong><span data-type="mention" data-id="abrechnungsjahr" data-label="Abrechnungsjahr">Abrechnungsjahr</span></strong>.</p><p>Die Abrechnung wurde auf der Grundlage der mietvertraglichen Vereinbarungen und der gesetzlichen Bestimmungen der Betriebskostenverordnung (BetrKV) erstellt. Ihr Nutzungszeitraum belief sich dabei auf <strong><span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Nutzungszeitraum</span></strong>.</p><p>Die Zusammenfassung der Gesamtkosten sowie das Abrechnungsergebnis entnehmen Sie bitte der nachfolgenden Aufstellung:</p><p><span data-type="mention" data-id="nebenkosten_tabelle" data-label="Umlagetabelle">Umlagetabelle</span></p><p>Daraus ergibt sich für Sie ein Saldo in Höhe von <strong><span data-type="mention" data-id="saldo_betrag" data-label="Saldo (Ergebnis)">Saldo (Ergebnis)</span></strong> als <strong><span data-type="mention" data-id="saldo_art" data-label="Saldo Art (Nachzahlung/Gutschrift)">Saldo Art (Nachzahlung/Gutschrift)</span></strong>.</p><p><strong>Zahlungshinweis:</strong> Im Falle einer Nachzahlung bitten wir Sie, den ausstehenden Betrag innerhalb von 30 Tagen auf unser bekanntes Vermieterkonto unter Angabe des Verwendungszwecks zu überweisen. Eine etwaige Gutschrift wird mit der nächsten fälligen Mietzahlung verrechnet oder auf Ihr uns bekanntes Konto ausgezahlt.</p><p>Die detaillierte Aufteilung der einzelnen Kostenpositionen, der Umlageschlüssel und der Berechnungsschritte können Sie dem beigefügten Berechnungsblatt (Seite 2) entnehmen.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Betriebskostenabrechnung: Berechnungsblatt</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der Betriebskosten, die Umlageschlüssel und die Berechnungsschritte für Ihren Nutzungszeitraum:</p><p><span data-type="mention" data-id="nebenkosten_detail_tabelle" data-label="Detaillierte Umlagetabelle">Detaillierte Umlagetabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    fewo_invoice: {
        name: 'Fewo-Rechnung',
        category: 'FEWO-Rechnungen',
        subject: 'Rechnung über erbrachte Leistungen für Ihren Aufenthalt',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="gast_name" data-label="Gast-Name">Gast-Name</span></strong><br><span data-type="mention" data-id="gast_adresse" data-label="Gast-Adresse">Gast-Adresse</span></div><div class="letter-date" style="text-align: right; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 10pt; line-height: 1.4;">Nummer: <strong><span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></strong><br>Datum: <strong><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></strong><br>Zeitraum: <strong><span data-type="mention" data-id="buchungszeitraum" data-label="Buchungszeitraum">Buchungszeitraum</span></strong></div></div><div class="letter-subject">Rechnung Nr. <span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></div><div class="letter-body"><p>Sehr geehrte Damen und Herren,</p><p>wir bedanken uns herzlich für Ihren Aufenthalt in unserem Hause. Vereinbarungsgemäß erlauben wir uns, Ihnen die erbrachten Leistungen in Rechnung zu stellen:</p><p><span data-type="mention" data-id="positions_tabelle" data-label="Rechnungspositionen-Tabelle">Rechnungspositionen-Tabelle</span></p><p>Bitte überweisen Sie den fälligen Gesamtbetrag innerhalb von 14 Tagen auf unser angegebenes Bankkonto.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    fewo_credit_note: {
        name: 'Fewo-Gutschrift',
        category: 'FEWO-Rechnungen',
        subject: 'Gutschrift zu Ihrem Aufenthalt',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="gast_name" data-label="Gast-Name">Gast-Name</span></strong><br><span data-type="mention" data-id="gast_adresse" data-label="Gast-Adresse">Gast-Adresse</span></div><div class="letter-date" style="text-align: right; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 10pt; line-height: 1.4;">Nummer: <strong><span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></strong><br>Datum: <strong><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></strong><br>Zeitraum: <strong><span data-type="mention" data-id="buchungszeitraum" data-label="Buchungszeitraum">Buchungszeitraum</span></strong></div></div><div class="letter-subject">Gutschrift Nr. <span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></div><div class="letter-body"><p>Sehr geehrte Damen und Herren,</p><p>vereinbarungsgemäß erhalten Sie nachfolgend die Gutschrift für Ihren Aufenthalt bzw. Ihre Buchung:</p><p><span data-type="mention" data-id="positions_tabelle" data-label="Rechnungspositionen-Tabelle">Rechnungspositionen-Tabelle</span></p><p>Der Gutschriftbetrag wird Ihrem Konto in den nächsten Tagen gutgeschrieben oder vereinbarungsgemäß verrechnet.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    lease_residential: {
        name: 'Mietvertrag Wohnraum',
        category: 'Verträge',
        subject: 'Mietvertrag für Wohnraum',
        content_html: `<div class="letter-page"><div class="letter-body"><h2 style="text-align: center; font-size: 16px; font-weight: bold;">Mietvertrag für Wohnraum</h2><p>Zwischen dem Vermieter: <strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong><br>und dem Mieter: <strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong> wird folgender Wohnraummietvertrag geschlossen:</p><p><b>§ 1 Mietobjekt</b><br>Vermietet wird die Wohnung in der <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong>, Einheit: <strong><span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span></strong>. Dem Mieter werden ____________ Schlüssel ausgehändigt.</p><p><b>§ 2 Mietzeit & Kündigung</b><br>Das Mietverhältnis beginnt am <strong><span data-type="mention" data-id="einzug_datum" data-label="Einzugsdatum">Einzugsdatum</span></strong>. Es gilt die gesetzliche Kündigungsfrist. Ein Kündigungsverzicht von bis zu 24 Monaten kann vereinbart werden.</p><p><b>§ 3 Miete & Betriebskosten</b><br>Die monatliche Nettokaltmiete beträgt ________________ EUR. Die Vorauszahlung auf die Betriebskosten beträgt ________________ EUR, so dass sich ein monatlicher Gesamtbetrag von ________________ EUR ergibt. Die Abrechnung der Betriebskosten erfolgt jährlich.</p><p><b>§ 4 Mietkaution</b><br>Der Mieter leistet vor Übergabe eine Kaution in Höhe von 3 Nettokaltmieten (insgesamt ________________ EUR) auf ein Kautionskonto des Vermieters.</p><p><b>§ 5 Instandhaltung & Kleinreparaturen</b><br>Der Mieter trägt die Kosten für Kleinreparaturen an den ihm zugänglichen Installationsgegenständen bis zu einer Höhe von 120,00 EUR im Einzelfall, begrenzt auf maximal 8% der Jahresnettokaltmiete pro Jahr.</p><p><br>Ort, Datum: ___________________________<br><br><br>Unterschriften:<br><br>______________________ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ______________________<br>Vermieter &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Mieter</p></div></div>`
    },
    lease_commercial: {
        name: 'Mietvertrag Gewerbe',
        category: 'Verträge',
        subject: 'Mietvertrag für Gewerberäume',
        content_html: `<div class="letter-page"><div class="letter-body"><h2 style="text-align: center; font-size: 16px; font-weight: bold;">Mietvertrag für Gewerberäume</h2><p>Zwischen dem Vermieter: <strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong><br>und dem Mieter: <strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong> wird folgender Gewerbemietvertrag geschlossen:</p><p><b>§ 1 Mietobjekt & Nutzungszweck</b><br>Vermietet werden die Gewerberäume in der <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong>, Einheit: <strong><span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span></strong>. Die Räume dürfen ausschließlich als ________________ genutzt werden.</p><p><b>§ 2 Mietzeit</b><br>Das Mietverhältnis beginnt am <strong><span data-type="mention" data-id="einzug_datum" data-label="Einzugsdatum">Einzugsdatum</span></strong> und läuft fest bis zum ____________. Es verlängert sich um jeweils 1 Jahr, wenn es nicht 6 Monate vor Ablauf gekündigt wird.</p><p><b>§ 3 Miete & Wertsicherung (Indexierung)</b><br>Die monatliche Nettomiete beträgt ________________ EUR zzgl. USt. Die Mietpreisbildung wird indexiert. Ändert sich die Miete, wenn der Verbraucherpreisindex für Deutschland sich um mehr als 5% gegenüber dem Stand bei Vertragsabschluss ändert.</p><p><b>§ 4 Betriebskosten</b><br>Der Mieter trägt alle Betriebskosten im Sinne des § 2 BetrKV sowie sämtliche auf das Gebäude und Grundstück entfallenden Sach- und Haftpflichtversicherungen sowie die Grundsteuer.</p><p><b>§ 5 Umbau & Instandhaltung</b><br>Bauliche Veränderungen durch den Mieter bedürfen der vorherigen schriftlichen Zustimmung des Vermieters. Der Mieter haftet für alle Schäden.</p><p><br>Ort, Datum: ___________________________<br><br><br>Unterschriften:<br><br>______________________ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ______________________<br>Vermieter &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Mieter</p></div></div>`
    },
    lease_garage: {
        name: 'Mietvertrag Garagen & Stellplätze',
        category: 'Verträge',
        subject: 'Mietvertrag für Stellplatz / Garage',
        content_html: `<div class="letter-page"><div class="letter-body"><h2 style="text-align: center; font-size: 16px; font-weight: bold;">Mietvertrag für Garage / Stellplatz</h2><p>Zwischen dem Vermieter: <strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong><br>und dem Mieter: <strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong> wird folgender Stellplatzmietvertrag geschlossen:</p><p><b>§ 1 Mietobjekt</b><br>Vermietet wird die Garage / der Stellplatz Nr. ____ in der <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong>.</p><p><b>§ 2 Mietzeit & Kündigung</b><br>Das Mietverhältnis beginnt am <strong><span data-type="mention" data-id="einzug_datum" data-label="Einzugsdatum">Einzugsdatum</span></strong>. Es läuft auf unbestimmte Zeit und kann von beiden Parteien mit einer Frist von einem Monat zum Monatsende gekündigt werden.</p><p><b>§ 3 Miete & Zahlungsweise</b><br>Der monatliche Mietzins beträgt monatlich ________________ EUR. Er ist im Voraus bis spätestens zum dritten Werktag des Monats kostenfrei auf das Konto des Vermieters zu entrichten.</p><p><b>§ 4 Nutzung & Haftung</b><br>Die Garage / der Stellplatz darf ausschließlich zum Abstellen eines zugelassenen Kraftfahrzeugs genutzt werden. Die Lagerung von feuergefährlichen Stoffen oder Müll ist untersagt. Der Mieter haftet für jegliche Beschädigungen der Garage.</p><p><br>Ort, Datum: ___________________________<br><br><br>Unterschriften:<br><br>______________________ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ______________________<br>Vermieter &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Mieter</p></div></div>`
    },
    rent_increase: {
        name: 'Mieterhöhungsschreiben',
        category: 'Mieterhöhung',
        subject: 'Mieterhöhung für Ihr Mietobjekt gemäß § 558 BGB',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Mieterhöhung für Ihr Mietobjekt gemäß § 558 BGB</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>gemäß § 558 BGB möchte ich Sie um Ihre Zustimmung zu einer Anpassung der Nettokaltmiete für die von Ihnen bewohnte Wohnung im Mietobjekt <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>) bitten.</p><p>Ihre aktuelle Nettokaltmiete beträgt derzeit monatlich <strong><span data-type="mention" data-id="aktuelle_miete" data-label="Aktuelle Miete">Aktuelle Miete</span></strong>. Dieser Betrag liegt unterhalb der ortsüblichen Vergleichsmiete für vergleichbaren Wohnraum in unserer Region, welche derzeit laut geltendem Mietspiegel ca. 7,46 € bis 9,05 €/m² entspricht.</p><p>Da die Miete seit mindestens 15 Monaten unverändert geblieben ist und die Erhöhung innerhalb der letzten 3 Jahre die gesetzliche Kappungsgrenze von 20% nicht überschreitet, sind die gesetzlichen Voraussetzungen für eine Anpassung erfüllt.</p><p>Wir passen die Nettokaltmiete hiermit um einen Erhöhungsbetrag von <strong><span data-type="mention" data-id="erhoehungs_betrag" data-label="Erhöhungsbetrag">Erhöhungsbetrag</span></strong> an, woraus sich ab dem <strong><span data-type="mention" data-id="erhoehungs_datum" data-label="Wirksamkeitsdatum">Wirksamkeitsdatum</span></strong> eine neue Nettokaltmiete von monatlich <strong><span data-type="mention" data-id="neue_miete" data-label="Neue Miete">Neue Miete</span></strong> ergibt.</p><p>Der neue Gesamtbetrag (Nettokaltmiete zzgl. Nebenkostenvorauszahlungen) is ab dem Wirksamkeitsdatum zu entrichten. Wir bitten Sie höflich, die beiliegende Zustimmungserklärung unterschrieben bis zum <strong><span data-type="mention" data-id="zustimmungs_frist" data-label="Zustimmungsfrist">Zustimmungsfrist</span></strong> an uns zurückzusenden. Bitte beachten Sie, dass Sie gesetzlich ein zweimonatiges Sonderkündigungsrecht nach § 561 BGB besitzen.</p><p>Für Rückfragen stehen wir Ihnen gerne zur Verfügung.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    rent_increase_consent: {
        name: 'Zustimmungserklärung',
        category: 'Mieterhöhung',
        subject: 'Zustimmungserklärung zur Mieterhöhung',
        content_html: `<div class="letter-page"><div class="letter-body"><p style="font-size: 14px; font-weight: bold; text-align: center; margin-bottom: 20px;">Zustimmungserklärung zur Mieterhöhung</p><p>Hiermit stimme ich, <strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong>, wohnhaft in der <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>), der Anpassung der Miete zu.</p><p>Der monatlichen Kaltmiete von bisher <strong><span data-type="mention" data-id="aktuelle_miete" data-label="Aktuelle Miete">Aktuelle Miete</span></strong> um den Anpassungsbetrag von <strong><span data-type="mention" data-id="erhoehungs_betrag" data-label="Erhöhungsbetrag">Erhöhungsbetrag</span></strong> auf zukünftig monatlich <strong><span data-type="mention" data-id="neue_miete" data-label="Neue Miete">Neue Miete</span></strong> stimme ich ab dem <strong><span data-type="mention" data-id="erhoehungs_datum" data-label="Wirksamkeitsdatum">Wirksamkeitsdatum</span></strong> ausdrücklich zu.</p><p><br><br>Ort, Datum: ___________________________<br><br><br><br>______________________________________<br>Unterschrift des Mieters / aller Mieter</p></div></div>`
    },
    landlord_confirmation: {
        name: 'Wohnungsgeberbestätigung',
        category: 'Bescheinigungen',
        subject: 'Wohnungsgeberbestätigung nach § 19 BMG',
        content_html: `<div class="letter-page"><div class="letter-body"><h2 style="text-align: center; font-size: 16px; font-weight: bold;">Wohnungsgeberbestätigung nach § 19 Bundesmeldegesetz (BMG)</h2><p>Hiermit wird der <strong>Einzug</strong> der nachfolgenden Personen in die unten bezeichnete Wohnung bestätigt:</p><p><b>Eingezogene Personen:</b><br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong></p><p><b>Einzugsdatum:</b><br><strong><span data-type="mention" data-id="einzug_datum" data-label="Einzugsdatum">Einzugsdatum</span></strong></p><p><b>Anschrift der Wohnung:</b><br><strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong> (Einheit: <strong><span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span></strong>)</p><p><b>Name und Anschrift des Wohnungsgebers (Eigentümer / Vermieter):</b><br><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p style="font-size: 9px; color: #475569; margin-top: 15px;">Hinweis: Die Ausstellung dieser Bestätigung entspricht der gesetzlichen Auskunftspflicht des Wohnungsgebers gem. § 19 BMG. Unrichtige Angaben können als Ordnungswidrigkeit geahndet werden.</p><p><br>Ort, Datum: ___________________________<br><br><br>______________________________________<br>Unterschrift des Wohnungsgebers</p></div></div>`
    },
    rent_clearance_certificate: {
        name: 'Mietschuldenfreiheitsbescheinigung',
        category: 'Bescheinigungen',
        subject: 'Bescheinigung über Mietschuldenfreiheit',
        content_html: `<div class="letter-page"><div class="letter-body"><h2 style="text-align: center; font-size: 16px; font-weight: bold;">Bescheinigung über Mietschuldenfreiheit</h2><p>Hiermit bestätige ich, <strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong>, als Vermieter der Wohnung in der <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>), dass das Mietverhältnis mit <strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong> stets ordnungsgemäß verlaufen ist.</p><p>Die vereinbarte Miete sowie die fälligen Betriebskostenvorauszahlungen wurden bis zum heutigen Tag stets vollständig und fristgerecht entrichtet. Es bestehen zum aktuellen Zeitpunkt keinerlei Mietrückstände oder sonstige offene Forderungen aus dem genannten Mietverhältnis.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div></div>`
    },
    rental_guarantee: {
        name: 'Mietbürgschaft',
        category: 'Bescheinigungen',
        subject: 'Mietbürgschaftserklärung (Selbstschuldnerisch)',
        content_html: `<div class="letter-page"><div class="letter-body"><h2 style="text-align: center; font-size: 16px; font-weight: bold;">Mietbürgschaftserklärung (Selbstschuldnerisch)</h2><p>Für alle Forderungen aus dem Mietverhältnis über das Mietobjekt <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>) zwischen dem Vermieter <strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong> (Gläubiger) und dem Mieter <strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong> (Hauptschuldner) übernimmt der Bürge:</p><p>Bürge Name, Vorname: ___________________________<br>Anschrift: ___________________________</p><p>hiermit die selbstschuldnerische Bürgschaft unter Verzicht auf die Einrede der Vorausklage. Die Haftung erstreckt sich auf alle vertraglichen Verpflichtungen des Mieters (insb. Mietzahlungen, Nebenkosten, Schönheitsreparaturen sowie Schadensersatzansprüche) bis zu einem gesetzlich zulässigen Höchstbetrag von drei Nettokaltmieten (maximal __________________ EUR).</p><p><br>Ort, Datum: ___________________________<br><br><br>______________________________________<br>Unterschrift des Bürgen</p></div></div>`
    },
    termination_receipt: {
        name: 'Kündigungsbestätigung',
        category: 'Bescheinigungen',
        subject: 'Bestätigung Ihrer Wohnungskündigung',
        content_html: `<div class="letter-page"><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>hiermit bestätige ich den Erhalt Ihrer schriftlichen Kündigung vom ______________ für das Mietverhältnis über die Wohnung/Einheit <strong><span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span></strong> in der <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong>.</p><p>Das Mietverhältnis endet vertragsgemäß mit Ablauf des ______________.</p><p>Bezüglich des Termins zur Wohnungsübergabe und Erstellung des Übergabeprotokolls werden wir uns rechtzeitig mit Ihnen in Verbindung setzen, um einen gemeinsamen Termin abzustimmen.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div></div>`
    }
};

const SYSTEM_TEMPLATES = [
    { id: 'payment_reminder', label: 'Zahlungserinnerung', hasSubject: true, variables: DUNNING_VARIABLES, group: 'Mahnwesen' },
    { id: 'dunning_1', label: 'Mahnung (Stufe 1)', hasSubject: true, variables: DUNNING_VARIABLES, group: 'Mahnwesen' },
    { id: 'dunning_2', label: 'Abmahnung (Stufe 2)', hasSubject: true, variables: DUNNING_VARIABLES, group: 'Mahnwesen' },
    { id: 'dunning_final', label: 'Letzte Zahlungsaufforderung', hasSubject: true, variables: DUNNING_VARIABLES, group: 'Mahnwesen' },
    { id: 'utility_costs', label: 'Nebenkostenabrechnung', hasSubject: true, variables: UTILITY_VARIABLES, group: 'Nebenkosten' },
    { id: 'fewo_invoice', label: 'Fewo-Rechnung', hasSubject: true, variables: INVOICE_VARIABLES, group: 'FEWO-Rechnungen' },
    { id: 'fewo_credit_note', label: 'Fewo-Gutschrift', hasSubject: true, variables: INVOICE_VARIABLES, group: 'FEWO-Rechnungen' },
    { id: 'lease_residential', label: 'Mietvertrag Wohnraum', hasSubject: true, variables: GLOBAL_VARIABLES, group: 'Verträge' },
    { id: 'lease_commercial', label: 'Mietvertrag Gewerbe', hasSubject: true, variables: GLOBAL_VARIABLES, group: 'Verträge' },
    { id: 'lease_garage', label: 'Mietvertrag Garagen & Stellplätze', hasSubject: true, variables: GLOBAL_VARIABLES, group: 'Verträge' },
    { id: 'rent_increase', label: 'Mieterhöhungsschreiben', hasSubject: true, variables: RENT_INCREASE_VARIABLES, group: 'Mieterhöhung' },
    { id: 'rent_increase_consent', label: 'Zustimmungserklärung', hasSubject: true, variables: RENT_INCREASE_VARIABLES, group: 'Mieterhöhung' },
    { id: 'landlord_confirmation', label: 'Wohnungsgeberbestätigung', hasSubject: false, variables: CERTIFICATE_VARIABLES, group: 'Bescheinigungen' },
    { id: 'rent_clearance_certificate', label: 'Mietschuldenfreiheitsbescheinigung', hasSubject: true, variables: GLOBAL_VARIABLES, group: 'Bescheinigungen' },
    { id: 'rental_guarantee', label: 'Mietbürgschaft', hasSubject: true, variables: GLOBAL_VARIABLES, group: 'Bescheinigungen' },
    { id: 'termination_receipt', label: 'Kündigungsbestätigung', hasSubject: true, variables: GLOBAL_VARIABLES, group: 'Bescheinigungen' }
];

const LayoutDiv = Node.create({
    name: 'layoutDiv',
    group: 'block',
    content: 'block+',
    defining: true,
    addAttributes() {
        return {
            class: {
                default: null,
                parseHTML: element => element.getAttribute('class'),
                renderHTML: attributes => {
                    if (!attributes.class) return {};
                    return { class: attributes.class };
                }
            },
            style: {
                default: null,
                parseHTML: element => element.getAttribute('style'),
                renderHTML: attributes => {
                    if (!attributes.style) return {};
                    return { style: attributes.style };
                }
            }
        };
    },
    parseHTML() {
        return [
            {
                tag: 'div',
                getAttrs: node => {
                    const classes = ['letter-page', 'letter-sender', 'letter-recipient', 'letter-date', 'letter-subject', 'letter-object', 'letter-body', 'letter-footer', 'letter-header-row', 'footer-col'];
                    const hasMatchingClass = classes.some(c => node.classList.contains(c));
                    if (!hasMatchingClass) return false;
                    return {
                        class: node.getAttribute('class'),
                        style: node.getAttribute('style')
                    };
                }
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ['div', HTMLAttributes, 0];
    }
});

export const DocumentTemplates = () => {
    const { user } = useAuth();
    const { portfolios } = usePortfolio();
    
    const [selectedPortfolioId, setSelectedPortfolioId] = useState('global');

    const activePortfolio = (portfolios || []).find(p => p.id === selectedPortfolioId);
    const selectedPortfolioName = activePortfolio?.name || 'ImmoControlpro360 Vermietung';
    const selectedPortfolioCompany = activePortfolio?.company_name || '';
    const selectedPortfolioAddress = activePortfolio 
        ? `${activePortfolio.street || ''} ${activePortfolio.house_number || ''}, ${activePortfolio.zip || ''} ${activePortfolio.city || ''}`.trim() 
        : 'Musterstraße 12, 12345 Musterstadt';
    const selectedPortfolioEmail = activePortfolio?.email || 'kontakt@immocontrol360.de';
    const selectedPortfolioPhone = activePortfolio?.phone || '+49 (0) 1234 56789';
    const selectedPortfolioIban = activePortfolio?.iban || 'DE89 5003 0000 0123 4567 89';
    const selectedPortfolioBic = activePortfolio?.bic || 'WELADED1XXX';
    const selectedPortfolioBank = activePortfolio?.bank_name || 'Musterbank AG';
    const selectedPortfolioTax = activePortfolio?.tax_number || '09/123/45678';
    const selectedPortfolioVat = activePortfolio?.vat_id || 'DE 987654321';
    const [activeType, setActiveType] = useState('payment_reminder');
    const [previewPage, setPreviewPage] = useState(1);
    const [pageCount, setPageCount] = useState(1);
    const [subject, setSubject] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    
    useEffect(() => {
        setPreviewPage(1);
        if (editor) {
            let count = 0;
            editor.state.doc.descendants(node => {
                if (node.type.name === 'layoutDiv' && node.attrs.class === 'letter-page') {
                    count++;
                }
            });
            setPageCount(count > 0 ? count : 1);
        }
    }, [activeType]);

    useEffect(() => {
        if (editor && !loading) {
            let count = 0;
            editor.state.doc.descendants(node => {
                if (node.type.name === 'layoutDiv' && node.attrs.class === 'letter-page') {
                    count++;
                }
            });
            setPageCount(count > 0 ? count : 1);
            setPreviewPage(1);
        }
    }, [loading, editor]);

    // Custom template list from DB
    const [customTemplates, setCustomTemplates] = useState([]);
    
    // Modals
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newTemplateName, setNewTemplateName] = useState('');
    const [newTemplateCategory, setNewTemplateCategory] = useState('Eigene');
    const [newTemplateSubject, setNewTemplateSubject] = useState('');

    // TipTap Editor initialization
    const editor = useEditor({
        extensions: [
            StarterKit,
            LayoutDiv,
            Underline,
            TextAlign.configure({
                types: ['heading', 'paragraph'],
                alignments: ['left', 'center', 'right', 'justify'],
            }),
            TextStyle,
            Color,
            Mention.configure({
                HTMLAttributes: {
                    class: 'variable-chip',
                },
                renderLabel({ node }) {
                    return `${node.attrs.label ?? node.attrs.id}`;
                },
            }),
            Image.configure({
                inline: true,
                HTMLAttributes: {
                    class: 'editor-image',
                    style: 'max-height: 240px; object-fit: contain; margin: 10px 0; display: block;'
                }
            })
        ],
        content: '',
        onUpdate({ editor }) {
            let count = 0;
            editor.state.doc.descendants(node => {
                if (node.type.name === 'layoutDiv' && node.attrs.class === 'letter-page') {
                    count++;
                }
            });
            setPageCount(count > 0 ? count : 1);
        },
        editorProps: {
            handleDrop(view, event, slice, moved) {
                if (!moved && event.dataTransfer) {
                    const files = event.dataTransfer.files;
                    if (files && files.length > 0) {
                        const file = files[0];
                        if (file.type.startsWith('image/')) {
                            if (file.size > 2 * 1024 * 1024) {
                                alert('Das Bild darf maximal 2MB groß sein.');
                                return true;
                            }
                            const reader = new FileReader();
                            reader.onload = (readerEvent) => {
                                const base64 = readerEvent.target.result;
                                const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
                                if (coordinates) {
                                    const { schema } = view.state;
                                    const node = schema.nodes.image.create({ src: base64 });
                                    const transaction = view.state.tr.insert(coordinates.pos, node);
                                    view.dispatch(transaction);
                                }
                            };
                            reader.readAsDataURL(file);
                            return true;
                        }
                    }
                    const data = event.dataTransfer.getData('text/plain');
                    try {
                        const json = JSON.parse(data);
                        if (json && json.type === 'mention') {
                            const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
                            if (coordinates) {
                                const { schema } = view.state;
                                const node = schema.nodes.mention.create({ id: json.id, label: json.label });
                                const transaction = view.state.tr.insert(coordinates.pos, node);
                                view.dispatch(transaction);
                                return true;
                            }
                        }
                    } catch (e) {
                        // ignore error
                    }
                }
                return false;
            }
        }
    });

    // Combine system and custom templates
    const allTemplates = [
        ...SYSTEM_TEMPLATES.map(t => ({ ...t, isCustom: false })),
        ...customTemplates.map(t => ({ 
            id: t.type, 
            label: t.name, 
            hasSubject: true, 
            variables: GLOBAL_VARIABLES, 
            group: t.category || 'Eigene', 
            isCustom: true,
            dbId: t.id
        }))
    ];

    const activeConfig = allTemplates.find(t => t.id === activeType) || allTemplates[0];

    // Load templates from DB
    const fetchCustomTemplates = async () => {
        if (!user) return;
        try {
            const { data, error } = await supabase
                .from('document_templates')
                .select('*')
                .eq('user_id', user.id)
                .eq('is_custom', true);
            if (!error && data) {
                setCustomTemplates(data);
            }
        } catch (e) {
            console.error('Error fetching custom templates:', e);
        }
    };

    const loadTemplate = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const portfolioFilter = selectedPortfolioId === 'global' ? null : selectedPortfolioId;
            
            let query = supabase
                .from('document_templates')
                .select('*')
                .eq('user_id', user.id)
                .eq('type', activeType);

            if (portfolioFilter) {
                query = query.eq('portfolio_id', portfolioFilter);
            } else {
                query = query.is('portfolio_id', null);
            }

            const { data, error } = await query.maybeSingle();

            if (error) throw error;

            if (data) {
                setSubject(data.subject || '');
                editor?.commands.setContent(data.content_html || '');
            } else {
                // If it's a custom template, it must be in the DB.
                // If not found in portfolio-specific, try global custom template
                if (activeConfig.isCustom) {
                    if (portfolioFilter) {
                        const { data: globalCustom } = await supabase
                            .from('document_templates')
                            .select('*')
                            .eq('user_id', user.id)
                            .eq('type', activeType)
                            .is('portfolio_id', null)
                            .maybeSingle();
                        if (globalCustom) {
                            setSubject(globalCustom.subject || '');
                            editor?.commands.setContent(globalCustom.content_html || '');
                            setLoading(false);
                            return;
                        }
                    }
                    editor?.commands.setContent('');
                    setSubject('');
                    setLoading(false);
                    return;
                }

                // If portfolio-specific template doesn't exist, try loading the global template first
                if (portfolioFilter) {
                    const { data: globalData } = await supabase
                        .from('document_templates')
                        .select('*')
                        .eq('user_id', user.id)
                        .eq('type', activeType)
                        .is('portfolio_id', null)
                        .maybeSingle();
                    
                    if (globalData) {
                        setSubject(globalData.subject || '');
                        editor?.commands.setContent(globalData.content_html || '');
                        setLoading(false);
                        return;
                    }
                }
                
                // Fallback to hardcoded defaults
                const defaultVal = DEFAULT_TEMPLATES[activeType] || { subject: '', content_html: '' };
                setSubject(defaultVal.subject || '');
                editor?.commands.setContent(defaultVal.content_html || '');
            }
        } catch (error) {
            console.error('Error loading template:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchCustomTemplates();
        }
    }, [user]);

    useEffect(() => {
        if (editor) {
            loadTemplate();
        }
    }, [activeType, selectedPortfolioId, editor]);

    // Save template
    const handleSave = async () => {
        if (!user || !editor) return;
        setSaving(true);
        try {
            const portfolioFilter = selectedPortfolioId === 'global' ? null : selectedPortfolioId;
            const contentHtml = editor.getHTML();

            let query = supabase
                .from('document_templates')
                .select('id')
                .eq('user_id', user.id)
                .eq('type', activeType);

            if (portfolioFilter) {
                query = query.eq('portfolio_id', portfolioFilter);
            } else {
                query = query.is('portfolio_id', null);
            }

            const { data: existingRecord } = await query.maybeSingle();

            const payload = {
                user_id: user.id,
                portfolio_id: portfolioFilter,
                type: activeType,
                name: activeConfig.label || activeConfig.name,
                subject: activeConfig.hasSubject ? subject : null,
                content_html: contentHtml,
                is_custom: activeConfig.isCustom,
                category: activeConfig.group,
                updated_at: new Date()
            };

            if (existingRecord) {
                payload.id = existingRecord.id;
            }

            const { error } = await supabase
                .from('document_templates')
                .upsert([payload]);

            if (error) throw error;
            alert('Vorlage erfolgreich gespeichert.');
            fetchCustomTemplates();
        } catch (error) {
            console.error('Error saving template:', error);
            alert('Fehler beim Speichern der Vorlage: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    // Reset to defaults (system templates only)
    const handleReset = () => {
        if (activeConfig.isCustom) return;
        if (window.confirm('Möchten Sie diese Vorlage wirklich auf die Standardeinstellungen zurücksetzen? Ungespeicherte Änderungen gehen verloren.')) {
            const defaultVal = DEFAULT_TEMPLATES[activeType] || { subject: '', content_html: '' };
            setSubject(defaultVal.subject || '');
            editor?.commands.setContent(defaultVal.content_html || '');
        }
    };

    // Create custom template
    const handleCreateTemplate = async () => {
        if (!newTemplateName.trim()) return alert('Name fehlt.');
        try {
            const portfolioFilter = selectedPortfolioId === 'global' ? null : selectedPortfolioId;
            const customType = `custom_${Date.now()}`;

            const payload = {
                user_id: user.id,
                portfolio_id: portfolioFilter,
                type: customType,
                name: newTemplateName.trim(),
                subject: newTemplateSubject.trim() || null,
                content_html: `<p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>Geben Sie hier Ihren Text ein...</p>`,
                is_custom: true,
                category: newTemplateCategory
            };

            const { error } = await supabase
                .from('document_templates')
                .insert([payload]);

            if (error) throw error;

            setIsCreateModalOpen(false);
            setNewTemplateName('');
            setNewTemplateSubject('');
            
            await fetchCustomTemplates();
            setActiveType(customType);
        } catch (error) {
            alert('Fehler beim Erstellen der Vorlage: ' + error.message);
        }
    };

    // Delete custom template
    const handleDeleteTemplate = async (templateId, type) => {
        if (!window.confirm('Möchten Sie diese Vorlage wirklich löschen?')) return;
        try {
            const { error } = await supabase
                .from('document_templates')
                .delete()
                .eq('user_id', user.id)
                .eq('type', type);

            if (error) throw error;

            await fetchCustomTemplates();
            setActiveType('payment_reminder');
        } catch (error) {
            alert('Fehler beim Löschen: ' + error.message);
        }
    };

    // Insert variable chip into editor
    const insertVariable = (variable) => {
        if (!editor) return;
        
        editor.chain().focus().insertContent({
            type: 'mention',
            attrs: {
                id: variable.id,
                label: variable.label
            }
        }).insertContent(' ').run();
    };

    // Handle Image insertion (Base64)
    const handleImageInsert = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) {
                alert('Das Bild darf maximal 2MB groß sein.');
                return;
            }
            const reader = new FileReader();
            reader.onload = (readerEvent) => {
                const base64 = readerEvent.target.result;
                editor?.chain().focus().setImage({ src: base64 }).run();
            };
            reader.readAsDataURL(file);
        }
    };

    // Categories groups list
    const groups = [
        'Mahnwesen', 
        'Nebenkosten', 
        'FEWO-Rechnungen', 
        'Verträge', 
        'Mieterhöhung', 
        'Bescheinigungen', 
        'Eigene'
    ];

    // Filter templates to make sure we don't display empty groups
    const availableGroups = groups.filter(g => allTemplates.some(t => t.group === g));

    const sheetStyle = {
        width: '100%',
        maxWidth: '800px',
        backgroundColor: '#ffffff',
        minHeight: '1130px',
        padding: '4rem 3rem 4rem 3rem',
        boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
        borderRadius: '4px',
        border: '1px solid #cbd5e1',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        boxSizing: 'border-box'
    };

    const renderUtilityLayout = () => {
        if (previewPage === 1) {
            return (
                <div style={sheetStyle}>
                    {/* Small sender header */}
                    <div style={{ fontSize: '8px', color: '#aaa', borderBottom: '1px solid #ddd', paddingBottom: '3px', marginBottom: '10px', textTransform: 'uppercase' }}>
                        {selectedPortfolioName} • {selectedPortfolioAddress}
                    </div>
                    
                    {/* Recipient Block & Date */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                        <div style={{ fontSize: '11px', lineHeight: '1.5' }}>
                            Herr/Frau Max Mustermann<br />
                            Musterweg 12<br />
                            12345 Musterstadt
                        </div>
                        <div style={{ fontSize: '11px', textAlign: 'right' }}>
                            {new Date().toLocaleDateString('de-DE')}
                        </div>
                    </div>

                    {/* Editor Content (the entire text template) */}
                    <div style={{ flex: 1, minHeight: '300px' }}>
                        <EditorContent editor={editor} />
                    </div>

                    {/* Ihre Daten Box (rendered as preview at the bottom) */}
                    <div style={{ border: '1px solid var(--primary-color)', borderRadius: '3px', padding: '8px 10px', margin: '10px 0', position: 'relative' }}>
                        <div style={{ position: 'absolute', top: '-8px', left: '8px', background: '#fff', padding: '0 5px', fontWeight: '600', color: 'var(--primary-color)', fontSize: '9px' }}>Vorschau: Ihre Daten</div>
                        <table style={{ width: '100%', fontSize: '9px' }}>
                            <tbody>
                                <tr>
                                    <td style={{ width: '40%', padding: '1px 0' }}><span style={{ color: '#aaa', fontSize: '8px' }}>Adresse</span><br /><b>Musterstraße 42<br />12345 Musterstadt</b></td>
                                    <td style={{ width: '30%', padding: '1px 0' }}><span style={{ color: '#aaa', fontSize: '8px' }}>Lage</span><br /><b>EG links</b></td>
                                    <td style={{ width: '30%', padding: '1px 0' }}><span style={{ color: '#aaa', fontSize: '8px' }}>Abrechnungszeitraum</span><br /><b style={{ color: 'var(--primary-color)' }}>01.01.2025 - 31.12.2025</b></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* Summary Table */}
                    <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse', marginBottom: '15px' }}>
                        <thead>
                            <tr>
                                <th></th>
                                <th style={{ textAlign: 'right', fontWeight: '600', fontStyle: 'italic', paddingBottom: '3px' }}>Brutto</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style={{ borderTop: '2px solid #1f2937' }}>
                                <td style={{ padding: '4px 0' }}>Ihre Gesamtkosten</td>
                                <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: '700' }}>550,00 €</td>
                            </tr>
                            <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                                <td style={{ padding: '3px 0', color: '#555' }}>Ihre Betriebskosten-Vorauszahlung</td>
                                <td style={{ padding: '3px 0', textAlign: 'right' }}>400,00 €</td>
                            </tr>
                            <tr style={{ borderTop: '2px solid #1f2937' }}>
                                <td style={{ padding: '5px 0', fontWeight: '700', fontSize: '11px' }}>⬅ <b style={{ color: '#16a34a' }}>Ihre Gutschrift</b></td>
                                <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: '700', fontSize: '11px', color: '#16a34a' }}>50,00 €</td>
                            </tr>
                        </tbody>
                    </table>

                    {/* Golden Page number footer */}
                    <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 'auto', paddingTop: '10px', fontSize: '8px', color: '#e6a817', letterSpacing: '2px', fontWeight: '600' }}>
                        SEITE 1 / 2
                    </div>
                </div>
            );
        } else {
            return (
                <div style={sheetStyle}>
                    <h3 style={{ fontSize: '12px', fontWeight: '700', margin: '0 0 10px' }}>Aufteilung der Gesamtkosten für Ihr Mietobjekt (01.01.2025 - 31.12.2025)</h3>
                    
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px', marginBottom: '20px' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid #1f2937' }}>
                                <th style={{ textAlign: 'left', padding: '3px' }}>Kostenart</th>
                                <th style={{ textAlign: 'left', padding: '3px' }}>Verteilerschlüssel</th>
                                <th style={{ textAlign: 'right', padding: '3px' }}>Gesamtkosten</th>
                                <th style={{ textAlign: 'right', padding: '3px' }}>Gesamteinheiten</th>
                                <th style={{ textAlign: 'right', padding: '3px' }}>Kosten / Einheit</th>
                                <th style={{ textAlign: 'right', padding: '3px' }}>Ihre Einheiten</th>
                                <th style={{ textAlign: 'right', padding: '3px' }}>Ihr Kostenanteil</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style={{ borderBottom: '1px solid #eee' }}>
                                <td style={{ padding: '3px', fontWeight: '700' }}>Grundsteuer</td>
                                <td style={{ padding: '3px' }}>Wohnfläche</td>
                                <td style={{ padding: '3px', textAlign: 'right' }}>450,00 €</td>
                                <td style={{ padding: '3px', textAlign: 'right' }}>300,00 m²</td>
                                <td style={{ padding: '3px', textAlign: 'right' }}>1,50 € / m²</td>
                                <td style={{ padding: '3px', textAlign: 'right' }}>100,00 m²</td>
                                <td style={{ padding: '3px', textAlign: 'right', fontWeight: '700' }}>150,00 €</td>
                            </tr>
                            <tr style={{ borderBottom: '1px solid #eee' }}>
                                <td style={{ padding: '3px', fontWeight: '700' }}>Kaltwasser / Abwasser</td>
                                <td style={{ padding: '3px' }}>Personen</td>
                                <td style={{ padding: '3px', textAlign: 'right' }}>1.200,00 €</td>
                                <td style={{ padding: '3px', textAlign: 'right' }}>6,00 P.</td>
                                <td style={{ padding: '3px', textAlign: 'right' }}>200,00 € / P.</td>
                                <td style={{ padding: '3px', textAlign: 'right' }}>2,00 P.</td>
                                <td style={{ padding: '3px', textAlign: 'right', fontWeight: '700' }}>400,00 €</td>
                            </tr>
                            <tr style={{ borderTop: '2px solid #1f2937' }}>
                                <td colSpan="6" style={{ padding: '5px 0', fontWeight: '700' }}>Gesamtsumme (zeitanteilig)</td>
                                <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: '700' }}>550,00 €</td>
                            </tr>
                        </tbody>
                    </table>

                    <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 'auto', paddingTop: '10px', fontSize: '8px', color: '#e6a817', letterSpacing: '2px', fontWeight: '600' }}>
                        SEITE 2 / 2
                    </div>
                </div>
            );
        }
    };

    const renderInvoiceLayout = () => {
        const titleText = activeType === 'fewo_credit_note' ? 'Gutschrift Nr. GS-2026-0001' : 'Rechnung Nr. RE-2026-0001';
        
        return (
            <div style={sheetStyle}>
                {/* Sender small line */}
                <div style={{ fontSize: '7pt', textDecoration: 'underline', color: '#555', marginBottom: '15px' }}>
                    {selectedPortfolioCompany || selectedPortfolioName} • {selectedPortfolioAddress}
                </div>

                {/* Recipient & Info Block */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
                    <div style={{ fontSize: '11pt', lineHeight: '1.4' }}>
                        <strong>Herrn / Frau</strong><br />
                        <strong>Max Mustermann (Gast)</strong><br />
                        Musterweg 12<br />
                        12345 Musterstadt
                    </div>
                    <div style={{ fontSize: '10pt', backgroundColor: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                            <span style={{ color: '#555' }}>Nummer:</span>
                            <span style={{ fontWeight: '600' }}>RE-2026-0001</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                            <span style={{ color: '#555' }}>Datum:</span>
                            <span style={{ fontWeight: '600' }}>{new Date().toLocaleDateString('de-DE')}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                            <span style={{ color: '#555' }}>Zeitraum:</span>
                            <span style={{ fontWeight: '600' }}>15.05.2026 - 18.05.2026</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#555' }}>Gäste:</span>
                            <span style={{ fontWeight: '600' }}>2</span>
                        </div>
                    </div>
                </div>

                {/* Headline */}
                <div style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: '20px', borderBottom: '1px solid #000', paddingBottom: '5px' }}>
                    {titleText}
                </div>

                {/* Editor Content */}
                <div style={{ flex: 1, minHeight: '350px' }}>
                    <EditorContent editor={editor} />
                </div>

                {/* DIN 5008 3-Column Footer */}
                <div style={{ borderTop: '1px solid #ccc', marginTop: 'auto', paddingTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', fontSize: '7.5pt', color: '#444', lineHeight: '1.4' }}>
                    <div>
                        <strong>Anschrift</strong><br />
                        {selectedPortfolioCompany || selectedPortfolioName}<br />
                        {selectedPortfolioAddress}
                    </div>
                    <div>
                        <strong>Kontakt</strong><br />
                        Tel: {selectedPortfolioPhone}<br />
                        Email: {selectedPortfolioEmail}
                    </div>
                    <div>
                        <strong>Bankverbindung</strong><br />
                        {selectedPortfolioBank}<br />
                        IBAN: {selectedPortfolioIban}<br />
                        BIC: {selectedPortfolioBic}<br />
                        {selectedPortfolioTax && `St.-Nr.: ${selectedPortfolioTax}`}
                    </div>
                </div>
            </div>
        );
    };

    const renderDunningLayout = () => {
        if (previewPage === 1) {
            return (
                <div style={sheetStyle}>
                    {/* 1. Absenderzeile (DIN 5008 Typ B: y=45) */}
                    <div style={{ fontSize: '7px', color: '#000', borderBottom: '1px solid #ddd', paddingBottom: '3px', marginBottom: '15px' }}>
                        {selectedPortfolioCompany || selectedPortfolioName} · {selectedPortfolioAddress}
                    </div>

                    {/* 2. Empfängerblock & Date */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '35px' }}>
                        <div style={{ fontSize: '9px', lineHeight: '1.4' }}>
                            Herrn/Frau<br />
                            <strong>Max Mustermann</strong><br />
                            Musterweg 12<br />
                            12345 Musterstadt
                        </div>
                        <div style={{ fontSize: '11px', textAlign: 'right', alignSelf: 'flex-end' }}>
                            Musterstadt, den {new Date().toLocaleDateString('de-DE')}
                        </div>
                    </div>

                    {/* 3. Betreff & Mietobjekt */}
                    <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>
                        {subject || activeConfig.label}
                    </div>
                    <div style={{ fontSize: '11px', marginBottom: '25px' }}>
                        Mietobjekt: Musterstraße 42, 12345 Musterstadt (Einheit: EG links)
                    </div>

                    {/* 4. Editor Content */}
                    <div style={{ flex: 1 }}>
                        <EditorContent editor={editor} />
                    </div>

                    {/* Footer */}
                    <div style={{ borderTop: '1px solid #eee', marginTop: 'auto', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#969696' }}>
                        <span>{activeConfig.label} - Stand {new Date().toLocaleDateString('de-DE')}</span>
                        <span>Seite 1 von 2</span>
                    </div>
                </div>
            );
        } else {
            return (
                <div style={sheetStyle}>
                    {/* Header */}
                    <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '15px', borderBottom: '1.5px solid #000', paddingBottom: '5px' }}>
                        Anlage zur Mahnung: Forderungsaufstellung & Informationen
                    </div>

                    {/* 5. Mock Forderungszusammenfassung Table */}
                    <div style={{ marginTop: '10px' }}>
                        <h4 style={{ fontSize: '10px', fontWeight: 'bold', margin: '0 0 5px' }}>Forderungszusammenfassung</h4>
                        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', marginBottom: '15px' }}>
                            <tbody>
                                <tr style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '4px 0' }}>Offene Hauptforderungen (Miete/Nebenkosten)</td>
                                    <td style={{ padding: '4px 0', textAlign: 'right' }}>900,00 €</td>
                                </tr>
                                <tr style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '4px 0' }}>Verzugszinsen (5,00 % p.a. bis heute)</td>
                                    <td style={{ padding: '4px 0', textAlign: 'right' }}>3,70 €</td>
                                </tr>
                                <tr style={{ borderBottom: '1.5px solid #000' }}>
                                    <td style={{ padding: '4px 0' }}>Mahnauslagen für dieses Schreiben</td>
                                    <td style={{ padding: '4px 0', textAlign: 'right' }}>5,00 €</td>
                                </tr>
                                <tr style={{ fontWeight: 'bold' }}>
                                    <td style={{ padding: '6px 0' }}>Gesamtforderung zum {new Date().toLocaleDateString('de-DE')}</td>
                                    <td style={{ padding: '6px 0', textAlign: 'right' }}>908,70 €</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* 6. QR Code Box */}
                    <div style={{
                        backgroundColor: '#f5f7fa',
                        border: '0.42mm dashed #b4bcc8',
                        borderRadius: '6px',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                        margin: '15px 0',
                    }}>
                        <div style={{ width: '80px', height: '80px', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', marginBottom: '6px' }}>[QR-Code]</div>
                        <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#1e293b', marginBottom: '4px' }}>Online Forderungsportal</div>
                        <div style={{ fontSize: '9.5px', color: '#475569', maxWidth: '400px', marginBottom: '5px' }}>
                            Sie können die aktuelle Forderung auch online einsehen und eine Ratenzahlung anfragen. Scannen Sie hierzu den QR-Code und geben Sie den unten genannten Zugangscode ein.
                        </div>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#1e293b' }}>
                            Zugangscode (PIN): 9821
                        </div>
                    </div>

                    {/* 7. Signature */}
                    <div style={{ marginTop: '15px' }}>
                        Mit freundlichen Grüßen,<br /><br />
                        <strong>{selectedPortfolioCompany || selectedPortfolioName}</strong>
                    </div>

                    {/* 8. Anlagen Block */}
                    <div style={{ marginTop: '20px', fontSize: '9px', borderTop: '1px solid #eee', paddingTop: '10px' }}>
                        <strong>Anlagen:</strong><br />
                        1. Forderungsaufstellung<br />
                        2. Zinsberechnung<br />
                        3. Übersicht: Ablauf bei Mietrückstand und mögliche Folgekosten
                    </div>

                    {/* Footer */}
                    <div style={{ borderTop: '1px solid #eee', marginTop: 'auto', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#969696' }}>
                        <span>{activeConfig.label} - Stand {new Date().toLocaleDateString('de-DE')}</span>
                        <span>Seite 2 von 2</span>
                    </div>
                </div>
            );
        }
    };

    const renderDefaultDIN5008Layout = () => {
        return (
            <div style={sheetStyle}>
                {/* Absenderzeile */}
                <div style={{ fontSize: '7px', color: '#000', borderBottom: '1px solid #ddd', paddingBottom: '3px', marginBottom: '15px' }}>
                    {selectedPortfolioCompany || selectedPortfolioName} · {selectedPortfolioAddress}
                </div>

                {/* Empfängerblock & Date */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '35px' }}>
                    <div style={{ fontSize: '9px', lineHeight: '1.4' }}>
                        Herrn/Frau<br />
                        <strong>Max Mustermann</strong><br />
                        Musterweg 12<br />
                        12345 Musterstadt
                    </div>
                    <div style={{ fontSize: '11px', textAlign: 'right', alignSelf: 'flex-end' }}>
                        Musterstadt, den {new Date().toLocaleDateString('de-DE')}
                    </div>
                </div>

                {/* Betreff */}
                <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '15px', borderBottom: '1px solid #f1f5f9', paddingBottom: '5px' }}>
                    {subject || activeConfig.label}
                </div>

                {/* Editor Content */}
                <div style={{ flex: 1 }}>
                    <EditorContent editor={editor} />
                </div>

                {/* Footer */}
                <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 'auto', paddingTop: '15px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', fontSize: '7.5px', color: '#64748b', lineHeight: '1.5', pointerEvents: 'none' }}>
                    <div>
                        <strong>Bankverbindung:</strong><br />
                        Empfänger: {selectedPortfolioCompany || selectedPortfolioName}<br />
                        Bank: {selectedPortfolioBank}<br />
                        IBAN: {selectedPortfolioIban}<br />
                        BIC: {selectedPortfolioBic}
                    </div>
                    <div>
                        <strong>Steuerdaten & Kontakt:</strong><br />
                        Steuernummer: {selectedPortfolioTax}<br />
                        USt-IdNr.: {selectedPortfolioVat}<br />
                        E-Mail: {selectedPortfolioEmail}
                    </div>
                </div>
            </div>
        );
    };

    const renderDocumentLayout = () => {
        const isDunning = activeConfig.group === 'Mahnwesen';
        const isUtility = activeConfig.group === 'Nebenkosten';
        const isInvoice = activeConfig.group === 'FEWO-Rechnungen';
        
        if (isUtility) {
            return renderUtilityLayout();
        } else if (isInvoice) {
            return renderInvoiceLayout();
        } else if (isDunning) {
            return renderDunningLayout();
        } else {
            return renderDefaultDIN5008Layout();
        }
    };

    const activePage = Math.min(previewPage, pageCount);

    return (
        <Card title="Schreibvorlagen verwalten" subtitle="Passe hier die automatischen Anschreiben, Mahnstufen, Verträge und Rechnungs-Texte nach deinen Vorstellungen an oder erstelle freie Briefe.">
            {/* Portfolio Selector & Add template button */}
            <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Portfolio-Auswahl:</span>
                    <select 
                        value={selectedPortfolioId} 
                        onChange={e => setSelectedPortfolioId(e.target.value)}
                        style={{ 
                            padding: '6px 12px', 
                            borderRadius: '6px', 
                            border: '1px solid var(--border-color)',
                            fontSize: '0.875rem',
                            backgroundColor: 'var(--surface-color)'
                        }}
                    >
                        <option value="global">Standard (alle Portfolios)</option>
                        {(portfolios || []).map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                    <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }} title="Vorlagen können global oder für ein spezifisches Portfolio definiert werden. Wenn für ein Portfolio keine eigene Vorlage existiert, wird die globale Vorlage verwendet.">
                        <HelpCircle size={16} />
                    </div>
                </div>

                <Button 
                    variant="primary" 
                    size="sm" 
                    icon={Plus} 
                    onClick={() => setIsCreateModalOpen(true)}
                >
                    Neue Vorlage
                </Button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.5rem', alignItems: 'stretch' }}>
                {/* Left side: Navigation of templates & Variable Library */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    
                    {/* Templates Navigation list */}
                    <div style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '1rem', 
                        border: '1px solid var(--border-color)', 
                        borderRadius: 'var(--radius-md)', 
                        padding: '12px', 
                        backgroundColor: 'var(--background-color)',
                        maxHeight: '350px',
                        overflowY: 'auto'
                    }}>
                        <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 5px 0' }}>Vorlagen-Kategorien</h4>
                        {availableGroups.map(groupName => (
                            <div key={groupName} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', paddingLeft: '4px', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Folder size={12} /> {groupName}
                                </div>
                                {allTemplates.filter(t => t.group === groupName).map(t => (
                                    <div 
                                        key={t.id} 
                                        style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'space-between',
                                            paddingRight: '4px',
                                            borderRadius: '6px',
                                            backgroundColor: activeType === t.id ? 'var(--primary-color)' : 'transparent',
                                        }}
                                    >
                                        <button
                                            onClick={() => setActiveType(t.id)}
                                            style={{
                                                flex: 1,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '8px 10px',
                                                border: 'none',
                                                background: 'none',
                                                color: activeType === t.id ? 'white' : 'var(--text-primary)',
                                                textAlign: 'left',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                fontWeight: activeType === t.id ? 500 : 400,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap'
                                            }}
                                        >
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
                                        </button>
                                        
                                        {t.isCustom && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t.dbId, t.id); }}
                                                title="Vorlage löschen"
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    color: activeType === t.id ? '#fee2e2' : 'var(--danger-color)',
                                                    padding: '6px',
                                                    display: 'flex',
                                                    alignItems: 'center'
                                                }}
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>

                    {/* Variable Library */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', backgroundColor: 'var(--background-color)', flex: 1 }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0' }}>Platzhalter</h4>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Klicke oder ziehe den Platzhalter in das Dokument.</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', maxHeight: '300px', paddingRight: '4px' }}>
                            {activeConfig.variables?.map(v => (
                                <button
                                    key={v.id}
                                    onClick={() => insertVariable(v)}
                                    draggable="true"
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'mention', id: v.id, label: v.label }));
                                    }}
                                    title={`Ziehe oder klicke, um ${v.label} einzufügen`}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '6px 8px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--border-color)',
                                        backgroundColor: 'var(--surface-color)',
                                        cursor: 'grab',
                                        fontSize: '0.75rem',
                                        fontWeight: 500,
                                        color: 'var(--text-primary)',
                                        textAlign: 'left',
                                        transition: 'all 0.15s ease'
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.borderColor = 'var(--primary-color)';
                                        e.currentTarget.style.backgroundColor = '#f0f9ff';
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.borderColor = 'var(--border-color)';
                                        e.currentTarget.style.backgroundColor = 'var(--surface-color)';
                                    }}
                                >
                                    <span>{v.icon}</span>
                                    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Info explanation card for mieter_anrede placeholder */}
                        <div style={{ 
                            marginTop: '12px', 
                            padding: '10px', 
                            borderRadius: '6px', 
                            backgroundColor: '#eff6ff', 
                            border: '1px solid #bfdbfe',
                            fontSize: '0.74rem',
                            color: '#1e3a8a',
                            lineHeight: '1.4',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                                <HelpCircle size={14} color="#3b82f6" />
                                <span>Platzhalter „Sehr geehrte/r ...“</span>
                            </div>
                            <p style={{ margin: 0 }}>
                                Der Platzhalter <strong>mieter_anrede</strong> generiert automatisch die passende Anrede basierend auf den Mieterdaten:
                            </p>
                            <ul style={{ margin: '4px 0 0 0', paddingLeft: '14px', listStyleType: 'disc' }}>
                                <li>Frau: <em>„Sehr geehrte Frau [Nachname]“</em></li>
                                <li>Herr: <em>„Sehr geehrter Herr [Nachname]“</em></li>
                                <li>Mehrere/Sonstige: <em>„Sehr geehrte Damen und Herren“</em></li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Right side: The Word-like Editor */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px' }}>
                            <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary-color)' }} />
                        </div>
                    ) : (
                        <>
                            {/* Editor Toolbar & Canvas */}
                            <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}>
                                {/* Subject Line (if applicable) - Ganz oben über der Tool-Leiste */}
                                {activeConfig.hasSubject && (
                                    <div style={{ 
                                        padding: '12px 16px', 
                                        borderBottom: '1px solid var(--border-color)', 
                                        backgroundColor: '#f8fafc',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        animation: 'fadeIn 0.2s ease-out'
                                    }}>
                                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', minWidth: '70px' }}>Betreff:</span>
                                        <input
                                            type="text"
                                            placeholder="z.B. Mieterhöhung für Ihr Mietobjekt"
                                            value={subject}
                                            onChange={e => setSubject(e.target.value)}
                                            style={{ 
                                                flex: 1, 
                                                border: '1px solid var(--border-color)', 
                                                borderRadius: '4px', 
                                                padding: '6px 10px', 
                                                fontSize: '0.875rem',
                                                fontWeight: 600,
                                                color: 'var(--text-primary)',
                                                backgroundColor: '#ffffff',
                                                outline: 'none'
                                            }}
                                        />
                                    </div>
                                )}

                                {/* Toolbar */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '8px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', alignItems: 'center' }}>
                                    <button 
                                        type="button"
                                        onClick={() => editor?.chain().focus().toggleBold().run()} 
                                        disabled={!editor}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive('bold') ? '#e2e8f0' : 'transparent' }}
                                        title="Fett"
                                    >
                                        <Bold size={16} />
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => editor?.chain().focus().toggleItalic().run()} 
                                        disabled={!editor}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive('italic') ? '#e2e8f0' : 'transparent' }}
                                        title="Kursiv"
                                     >
                                         <Italic size={16} />
                                     </button>
                                     <button 
                                         type="button"
                                         onClick={() => editor?.chain().focus().toggleUnderline().run()} 
                                         disabled={!editor}
                                         style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive('underline') ? '#e2e8f0' : 'transparent' }}
                                         title="Unterstreichen"
                                     >
                                         <UnderlineIcon size={16} />
                                     </button>
                                     
                                     <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 4px' }} />

                                     {/* Formatierung Dropdown */}
                                     <select
                                         onChange={(e) => {
                                             const val = e.target.value;
                                             if (val === 'p') editor?.chain().focus().setParagraph().run();
                                             else if (val === 'h1') editor?.chain().focus().toggleHeading({ level: 1 }).run();
                                             else if (val === 'h2') editor?.chain().focus().toggleHeading({ level: 2 }).run();
                                             else if (val === 'h3') editor?.chain().focus().toggleHeading({ level: 3 }).run();
                                         }}
                                         value={
                                             editor?.isActive('heading', { level: 1 }) ? 'h1' :
                                             editor?.isActive('heading', { level: 2 }) ? 'h2' :
                                             editor?.isActive('heading', { level: 3 }) ? 'h3' : 'p'
                                         }
                                         style={{
                                             padding: '4px 8px',
                                             fontSize: '0.8rem',
                                             borderRadius: '4px',
                                             border: '1px solid var(--border-color)',
                                             backgroundColor: 'var(--surface-color)',
                                             cursor: 'pointer'
                                         }}
                                     >
                                         <option value="p">Standard Text</option>
                                         <option value="h1">Überschrift 1</option>
                                         <option value="h2">Überschrift 2</option>
                                         <option value="h3">Überschrift 3</option>
                                     </select>

                                     <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 4px' }} />

                                     {/* Textausrichtung */}
                                     <button 
                                         type="button"
                                         onClick={() => editor?.chain().focus().setTextAlign('left').run()} 
                                         disabled={!editor}
                                         style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive({ textAlign: 'left' }) ? '#e2e8f0' : 'transparent' }}
                                         title="Linksbündig"
                                     >
                                         <AlignLeft size={16} />
                                     </button>
                                     <button 
                                         type="button"
                                         onClick={() => editor?.chain().focus().setTextAlign('center').run()} 
                                         disabled={!editor}
                                         style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive({ textAlign: 'center' }) ? '#e2e8f0' : 'transparent' }}
                                         title="Zentriert"
                                     >
                                         <AlignCenter size={16} />
                                     </button>
                                     <button 
                                         type="button"
                                         onClick={() => editor?.chain().focus().setTextAlign('right').run()} 
                                         disabled={!editor}
                                         style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive({ textAlign: 'right' }) ? '#e2e8f0' : 'transparent' }}
                                         title="Rechtsbündig"
                                     >
                                         <AlignRight size={16} />
                                     </button>
                                     <button 
                                         type="button"
                                         onClick={() => editor?.chain().focus().setTextAlign('justify').run()} 
                                         disabled={!editor}
                                         style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive({ textAlign: 'justify' }) ? '#e2e8f0' : 'transparent' }}
                                         title="Blocksatz"
                                     >
                                         <AlignJustify size={16} />
                                     </button>

                                     <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 4px' }} />

                                     {/* Farbwähler (Standardfarben) */}


                                     <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }} title="Textfarbe">


                                         {[


                                             { hex: '#000000', label: 'Schwarz' },


                                             { hex: '#4b5563', label: 'Grau' },


                                             { hex: '#1d4ed8', label: 'Blau' },


                                             { hex: '#dc2626', label: 'Rot' }


                                         ].map(color => (


                                             <button


                                                 key={color.hex}


                                                 type="button"


                                                 onClick={() => editor?.chain().focus().setColor(color.hex).run()}


                                                 style={{


                                                     width: '18px',


                                                     height: '18px',


                                                     borderRadius: '50%',


                                                     border: editor?.isActive('textStyle', { color: color.hex }) 


                                                         ? '2px solid var(--primary-color)' 


                                                         : '1px solid #cbd5e1',


                                                     backgroundColor: color.hex,


                                                     cursor: 'pointer',


                                                     padding: 0,


                                                     boxSizing: 'border-box'


                                                 }}


                                                 title={color.label}


                                             />


                                         ))}


                                     </div>

                                     <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 4px' }} />

                                    <button 
                                        type="button"
                                        onClick={() => editor?.chain().focus().toggleBulletList().run()} 
                                        disabled={!editor}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive('bulletList') ? '#e2e8f0' : 'transparent' }}
                                        title="Aufzählungsliste"
                                    >
                                        <List size={16} />
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => editor?.chain().focus().toggleOrderedList().run()} 
                                        disabled={!editor}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive('orderedList') ? '#e2e8f0' : 'transparent' }}
                                        title="Nummerierte Liste"
                                    >
                                        <ListOrdered size={16} />
                                    </button>

                                    <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 4px' }} />

                                    {/* Image / Signature Upload Button */}
                                    <button 
                                        type="button"
                                        onClick={() => document.getElementById('template-image-upload').click()} 
                                        disabled={!editor}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                                        title="Bild / Unterschrift einfügen"
                                    >
                                        <ImageIcon size={16} />
                                    </button>
                                    <input 
                                        id="template-image-upload" 
                                        type="file" 
                                        accept="image/*" 
                                        onChange={handleImageInsert} 
                                        style={{ display: 'none' }} 
                                    />

                                    <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 4px' }} />

                                    <button 
                                        type="button"
                                        onClick={() => editor?.chain().focus().undo().run()} 
                                        disabled={!editor}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                                        title="Rückgängig"
                                    >
                                        <Undo size={16} />
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => editor?.chain().focus().redo().run()} 
                                        disabled={!editor}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                                        title="Wiederholen"
                                    >
                                        <Redo size={16} />
                                    </button>

                                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                                        {!activeConfig.isCustom && (
                                            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={handleReset} style={{ color: 'var(--text-secondary)' }}>
                                                Standard
                                            </Button>
                                        )}
                                        <Button variant="primary" size="sm" icon={Save} onClick={handleSave} loading={saving}>
                                            Speichern
                                        </Button>
                                    </div>
                                </div>

                                {/* Editor Content Area (Word-like white sheet with DIN 5008 formatting) */}
                                 <div style={{ 
                                     padding: '2.5rem', 
                                     backgroundColor: '#f8fafc', 
                                     display: 'flex', 
                                     flexDirection: 'column',
                                     alignItems: 'center',
                                     gap: '1.5rem',
                                     overflowY: 'auto',
                                     maxHeight: '750px',
                                     width: '100%'
                                 }}>
                                     {/* Horizontal Pagination Controls */}
                                     {pageCount > 1 && (
                                         <div style={{ 
                                             display: 'flex', 
                                             alignItems: 'center', 
                                             gap: '1.25rem', 
                                             padding: '8px 20px', 
                                             backgroundColor: '#ffffff', 
                                             borderRadius: '30px', 
                                             boxShadow: '0 4px 15px rgba(0,0,0,0.06)',
                                             border: '1px solid #e2e8f0',
                                             userSelect: 'none',
                                             marginBottom: '0.5rem'
                                         }}>
                                             <button
                                                 type="button"
                                                 onClick={() => setPreviewPage(prev => Math.max(1, prev - 1))}
                                                 disabled={activePage === 1}
                                                 style={{
                                                     display: 'flex',
                                                     alignItems: 'center',
                                                     justifyContent: 'center',
                                                     width: '32px',
                                                     height: '32px',
                                                     borderRadius: '50%',
                                                     border: 'none',
                                                     backgroundColor: activePage === 1 ? '#f1f5f9' : '#0ea5e9',
                                                     color: activePage === 1 ? '#94a3b8' : '#ffffff',
                                                     cursor: activePage === 1 ? 'not-allowed' : 'pointer',
                                                     transition: 'all 0.2s'
                                                 }}
                                                 title="Vorherige Seite (nach links)"
                                             >
                                                 <ChevronLeft size={20} />
                                             </button>
                                             <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#334155', minWidth: '100px', textAlign: 'center' }}>
                                                 Seite {activePage} von {pageCount}
                                             </span>
                                             <button
                                                 type="button"
                                                 onClick={() => setPreviewPage(prev => Math.min(pageCount, prev + 1))}
                                                 disabled={activePage === pageCount}
                                                 style={{
                                                     display: 'flex',
                                                     alignItems: 'center',
                                                     justifyContent: 'center',
                                                     width: '32px',
                                                     height: '32px',
                                                     borderRadius: '50%',
                                                     border: 'none',
                                                     backgroundColor: activePage === pageCount ? '#f1f5f9' : '#0ea5e9',
                                                     color: activePage === pageCount ? '#94a3b8' : '#ffffff',
                                                     cursor: activePage === pageCount ? 'not-allowed' : 'pointer',
                                                     transition: 'all 0.2s'
                                                 }}
                                                 title="Nächste Seite (nach rechts)"
                                             >
                                                 <ChevronRight size={20} />
                                             </button>
                                         </div>
                                     )}

                                     {/* CSS styling for Tiptap editor */}
                                     <style>{`
                                         .ProseMirror {
                                             outline: none;
                                             min-height: 250px;
                                             font-family: 'Segoe UI', Arial, sans-serif;
                                             font-size: 14px;
                                             line-height: 1.6;
                                             color: #1e293b;
                                             width: 100%;
                                         }
                                         .ProseMirror > .letter-page {
                                             display: none !important;
                                         }
                                         .ProseMirror > .letter-page:nth-of-type(${activePage}) {
                                             display: flex !important;
                                         }
                                         .ProseMirror p {
                                             margin-top: 0;
                                             margin-bottom: 0.75rem;
                                         }
                                         .ProseMirror ul, .ProseMirror ol {
                                             padding-left: 1.5rem;
                                             margin-top: 0;
                                             margin-bottom: 0.75rem;
                                         }
                                         .variable-chip {
                                             background-color: #e0f2fe !important;
                                             color: #0369a1 !important;
                                             border: 1px solid #bae6fd !important;
                                             border-radius: 4px !important;
                                             padding: 2px 6px !important;
                                             font-weight: 500 !important;
                                             display: inline-flex !important;
                                             align-items: center !important;
                                             margin: 0 2px !important;
                                             user-select: none !important;
                                             cursor: pointer !important;
                                             box-decoration-break: clone;
                                             font-size: 0.85em;
                                         }
                                         .table-placeholder-chip {
                                              background-color: #fef08a !important;
                                              color: #a16207 !important;
                                              border: 1px dashed #ca8a04 !important;
                                          }
                                          .editor-image {
                                             max-width: 100%;
                                             height: auto;
                                             max-height: 120px;
                                             border: 1px dashed #cbd5e1;
                                             border-radius: 4px;
                                             padding: 4px;
                                             display: block;
                                             margin: 10px 0;
                                         }
                                     `}</style>
                                     <EditorContent editor={editor} />
                                 </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Modal: Create new custom template */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title="Eigene Schreibvorlage erstellen"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Abbrechen</Button>
                        <Button variant="primary" onClick={handleCreateTemplate}>Erstellen</Button>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <Input 
                        label="Name der Vorlage *"
                        placeholder="z.B. Kündigungsbestätigung"
                        value={newTemplateName}
                        onChange={e => setNewTemplateName(e.target.value)}
                    />
                    <Input 
                        label="Betreffzeile (optional)"
                        placeholder="z.B. Bestätigung Ihres Kündigungsschreibens"
                        value={newTemplateSubject}
                        onChange={e => setNewTemplateSubject(e.target.value)}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>Kategorie</span>
                        <select 
                            value={newTemplateCategory} 
                            onChange={e => setNewTemplateCategory(e.target.value)}
                            style={{ 
                                padding: '8px 12px', 
                                borderRadius: '6px', 
                                border: '1px solid var(--border-color)',
                                fontSize: '0.875rem',
                                backgroundColor: 'var(--surface-color)'
                            }}
                        >
                            <option value="Mahnwesen">Mahnwesen</option>
                            <option value="Nebenkosten">Nebenkosten</option>
                            <option value="FEWO-Rechnungen">FEWO-Rechnungen</option>
                            <option value="Verträge">Verträge</option>
                            <option value="Mieterhöhung">Mieterhöhung</option>
                            <option value="Bescheinigungen">Bescheinigungen</option>
                            <option value="Eigene">Eigene</option>
                        </select>
                    </div>
                </div>
            </Modal>
        </Card>
    );
};

export default DocumentTemplates;
