import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import { Node, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Mention from '@tiptap/extension-mention';
import Image from '@tiptap/extension-image';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Selection, TextSelection } from '@tiptap/pm/state';
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
    ArrowLeft, ArrowRight, Minus, Strikethrough, Sliders, Eye, EyeOff,
    ArrowUp, ArrowDown, Layers
} from 'lucide-react';

// Deutsche Variablen für globale Verwendung
const GLOBAL_VARIABLES = [
    { id: 'mieter_name', label: 'Mieter Name', icon: '👤', description: 'Der vollständige Name des Hauptmieters.' },
    { id: 'mieter_anrede', label: 'Sehr geehrte/r ...', icon: '✉️', description: 'Die Briefanrede (z.B. "Sehr geehrte Frau Müller" oder "Sehr geehrter Herr Schmidt"), die automatisch anhand des Geschlechts des Mieters generiert wird.' },
    { id: 'mieter_adresse', label: 'Mieter Adresse', icon: '🏠', description: 'Die vollständige Anschrift des Mieters für das Adressfeld.' },
    { id: 'objekt_name', label: 'Objektname', icon: '🏢', description: 'Der Name des Gebäudes oder Objekts.' },
    { id: 'einheit_name', label: 'Wohneinheit', icon: '🚪', description: 'Die Bezeichnung der Wohneinheit (z.B. "EG links" oder "Wohnung Nr. 5").' },
    { id: 'objekt_adresse', label: 'Objekt-Adresse', icon: '📍', description: 'Die vollständige Adresse des Objekts.' },
    { id: 'vermieter_name', label: 'Vermieter Name', icon: '👤', description: 'Der Name des Vermieters (wird als Absender oder in der Grußformel genutzt).' },
    { id: 'vermieter_bankverbindung', label: 'Vermieter Bankverbindung', icon: '💳', description: 'Die hinterlegte IBAN und BIC des Vermieters für Zahlungsaufforderungen.' }
];

// Deutsche Variablen für das Mahnwesen
const DUNNING_VARIABLES = [
    ...GLOBAL_VARIABLES,
    { id: 'offener_betrag', label: 'Offener Betrag', icon: '💰', description: 'Der aktuell ausstehende Gesamtbetrag der Mahnung.' },
    { id: 'zahlungsfrist_datum', label: 'Fälligkeitsdatum', icon: '📅', description: 'Das Datum, bis zu dem die Zahlung auf dem Konto eingegangen sein muss.' },
    { id: 'verzugstage', label: 'Verzugstage', icon: '⏱️', description: 'Die Anzahl der Tage, die der Mieter bereits mit der Zahlung im Verzug ist.' },
    { id: 'mahnstufe', label: 'Mahnstufe', icon: '📈', description: 'Die aktuelle Stufe des Mahnverfahrens (z.B. 1, 2 oder Letzte Mahnung).' },
    { id: 'zinsbetrag', label: 'Verzugszinsen', icon: '💸', description: 'Der berechnete Verzugszinsbetrag basierend auf den Verzugstagen.' },
    { id: 'forderungs_tabelle', label: 'Forderungstabelle', icon: '📊', description: 'Eine strukturierte Tabelle, die alle offenen Posten, Mieten und Mahngebühren auflistet.' }
];

// Deutsche Variablen für Nebenkosten
const UTILITY_VARIABLES = [
    ...GLOBAL_VARIABLES,
    { id: 'abrechnungsjahr', label: 'Abrechnungsjahr', icon: '📅', description: 'Das Jahr, für das diese Nebenkostenabrechnung erstellt wird.' },
    { id: 'abrechnungszeitraum', label: 'Abrechnungszeitraum', icon: '📆', description: 'Der gesamte Zeitraum der Nebenkostenabrechnung (z.B. 01.01.2025 - 31.12.2025).' },
    { id: 'nutzungszeitraum', label: 'Nutzungszeitraum', icon: '⏳', description: 'Der genaue Zeitraum, in dem der Mieter die Wohnung im Abrechnungsjahr genutzt hat.' },
    { id: 'gesamtkosten_mieter', label: 'Gesamtkosten Mieter', icon: '💰', description: 'Die Summe aller Betriebskosten, die laut Verteilerschlüssel auf den Mieter entfallen.' },
    { id: 'vorauszahlungs_betrag', label: 'Geleistete Vorauszahlung', icon: '📥', description: 'Die Summe der vom Mieter im Abrechnungszeitraum bereits gezahlten Nebenkostenabschläge.' },
    { id: 'saldo_betrag', label: 'Saldo (Ergebnis)', icon: '💵', description: 'Der Differenzbetrag zwischen den Gesamtkosten und den Vorauszahlungen.' },
    { id: 'saldo_art', label: 'Saldo Art (Nachzahlung/Gutschrift)', icon: '📝', description: 'Gibt an, ob der Saldo eine "Nachzahlung" (Mieter muss zahlen) oder eine "Gutschrift" (Mieter erhält Geld zurück) ist.' },
    { id: 'nebenkosten_tabelle', label: 'Umlagetabelle', icon: '📊', description: 'Die detaillierte Umlagetabelle der Betriebskosten mit Kostenarten, Gesamtkosten, Umlageschlüsseln und Mieteranteil.' }
];

// Deutsche Variablen für Fewo-Rechnungen
const INVOICE_VARIABLES = [
    { id: 'gast_name', label: 'Gast Name', icon: '👤', description: 'Der Name des Ferienwohnungsgastes.' },
    { id: 'gast_adresse', label: 'Gast Adresse', icon: '🏠', description: 'Die Rechnungsadresse des Gastes.' },
    { id: 'buchungszeitraum', label: 'Leistungszeitraum', icon: '📅', description: 'Der Buchungszeitraum des Aufenthalts (Anreise- bis Abreisedatum).' },
    { id: 'gaeste_anzahl', label: 'Anzahl Gäste', icon: '👥', description: 'Die Anzahl der Personen, die die Ferienwohnung gebucht haben.' },
    { id: 'rechnungsnummer', label: 'Rechnungsnummer', icon: '🔢', description: 'Die fortlaufende, eindeutige Rechnungsnummer.' },
    { id: 'rechnungsdatum', label: 'Rechnungsdatum', icon: '📆', description: 'Das Datum, an dem die Rechnung ausgestellt wurde.' },
    { id: 'netto_betrag', label: 'Netto-Betrag', icon: '💰', description: 'Der Rechnungsbetrag vor Steuern.' },
    { id: 'mwst_betrag', label: 'MwSt-Betrag (7%)', icon: '💸', description: 'Der berechnete Umsatzsteuerbetrag (7% für Beherbergung).' },
    { id: 'brutto_betrag', label: 'Gesamtbetrag (Brutto)', icon: '💵', description: 'Der Endbetrag inklusive Umsatzsteuer.' },
    { id: 'original_rechnungsnummer', label: 'Ref-Rechnungsnummer', icon: '📎', description: 'Bei einer Stornierung oder Korrektur die Nummer der Originalrechnung.' },
    { id: 'positions_tabelle', label: 'Rechnungspositionen-Tabelle', icon: '📊', description: 'Eine Tabelle mit allen Rechnungspositionen wie Übernachtungskosten, Reinigung und Zusatzleistungen.' },
    { id: 'vermieter_name', label: 'Vermieter Name', icon: '👤', description: 'Der Name des Vermieters.' },
    { id: 'vermieter_bankverbindung', label: 'Vermieter Bankverbindung', icon: '💳', description: 'Die IBAN und BIC des Vermieters für die Überweisung.' },
    { id: 'vermieter_steuernummer', label: 'Vermieter Steuernummer', icon: '📝', description: 'Die Steuernummer des Vermieters für steuerliche Zwecke.' },
    { id: 'vermieter_ust_id', label: 'Vermieter USt-IdNr.', icon: '🆔', description: 'Die Umsatzsteuer-Identifikationsnummer des Vermieters.' }
];

// Deutsche Variablen für Mieterhöhungen
const RENT_INCREASE_VARIABLES = [
    ...GLOBAL_VARIABLES,
    { id: 'aktuelle_miete', label: 'Aktuelle Miete', icon: '💵', description: 'Der aktuelle monatliche Nettokaltmietpreis.' },
    { id: 'neue_miete', label: 'Neue Miete', icon: '📈', description: 'Der vorgeschlagene neue monatliche Nettokaltmietpreis.' },
    { id: 'erhoehungs_betrag', label: 'Erhöhungsbetrag', icon: '💰', description: 'Der monatliche Differenzbetrag der Mieterhöhung.' },
    { id: 'erhoehungs_datum', label: 'Wirksamkeitsdatum', icon: '📅', description: 'Das Datum, ab dem die neue Miete gelten soll.' },
    { id: 'zustimmungs_frist', label: 'Zustimmungsfrist', icon: '⏱️', description: 'Das Datum, bis zu dem der Mieter der Erhöhung zustimmen muss.' }
];

// Deutsche Variablen für sonstige Bescheinigungen
const CERTIFICATE_VARIABLES = [
    ...GLOBAL_VARIABLES,
    { id: 'einzug_datum', label: 'Einzugsdatum', icon: '📅', description: 'Das Einzugsdatum des Mieters laut Wohnungsgeberbestätigung.' }
];

const DEFAULT_TEMPLATES = {
    payment_reminder: {
        name: 'Zahlungserinnerung',
        category: 'Mahnwesen',
        subject: 'Zahlungserinnerung zu offenen Mietforderungen',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Zahlungserinnerung zu offenen Mietforderungen</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Bezüglich der offenen Posten besteht aktuell ein Zahlungsrückstand.</p><p>Trotz Fälligkeit wurde die nachfolgend aufgeführte Forderung nicht vollständig ausgeglichen. Bitte prüfen Sie den Vorgang und gleichen Sie den offenen Betrag aus.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-body"><p style="font-size: 12pt; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</p><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    dunning_1: {
        name: 'Mahnung (Stufe 1)',
        category: 'Mahnwesen',
        subject: 'Mahnung wegen Mietrückstand',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Mahnung wegen Mietrückstand</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-body"><p style="font-size: 12pt; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</p><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    dunning_2: {
        name: 'Abmahnung (Stufe 2)',
        category: 'Mahnwesen',
        subject: 'Abmahnung und Zahlungsaufforderung wegen Zahlungsverzug',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Abmahnung und Zahlungsaufforderung wegen Zahlungsverzug</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete is nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Aufgrund der Höhe des Rückstands kann zudem die Prüfung einer außerordentlichen fristlosen Kündigung gemäß § 543 Abs. 2 Nr. 3 BGB, hilfsweise einer ordentlichen Kündigung, in Betracht kommen. Für Wohnraummietverhältnisse sind zusätzlich die Regelungen des § 569 BGB zu beachten.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-body"><p style="font-size: 12pt; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</p><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    dunning_final: {
        name: 'Letzte Zahlungsaufforderung',
        category: 'Mahnwesen',
        subject: 'Letzte Zahlungsaufforderung vor weiteren Schritten',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Letzte Zahlungsaufforderung vor weiteren Schritten</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Mietbeginn">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete is nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-body"><p style="font-size: 12pt; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</p><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    utility_costs: {
        name: 'Nebenkostenabrechnung',
        category: 'Nebenkosten',
        subject: 'Betriebskostenabrechnung für das Abrechnungsjahr',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Betriebskostenabrechnung für das Abrechnungsjahr <span data-type="mention" data-id="abrechnungsjahr" data-label="Abrechnungsjahr">Abrechnungsjahr</span></div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>anbei erhalten Sie die ordnungsgemäße Betriebskostenabrechnung für Ihr Mietobjekt <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>) für das Abrechnungsjahr <strong><span data-type="mention" data-id="abrechnungsjahr" data-label="Abrechnungsjahr">Abrechnungsjahr</span></strong>.</p><p>Die Abrechnung wurde auf der Grundlage der mietvertraglichen Vereinbarungen und der gesetzlichen Bestimmungen der Betriebskostenverordnung (BetrKV) erstellt. Ihr Nutzungszeitraum belief sich dabei auf <strong><span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Nutzungszeitraum</span></strong>.</p><p>Die Zusammenfassung der Gesamtkosten sowie das Abrechnungsergebnis entnehmen Sie bitte der nachfolgenden Aufstellung:</p><p><span data-type="mention" data-id="nebenkosten_tabelle" data-label="Umlagetabelle">Umlagetabelle</span></p><p>Daraus ergibt sich für Sie ein Saldo in Höhe von <strong><span data-type="mention" data-id="saldo_betrag" data-label="Saldo (Ergebnis)">Saldo (Ergebnis)</span></strong> als <strong><span data-type="mention" data-id="saldo_art" data-label="Saldo Art (Nachzahlung/Gutschrift)">Saldo Art (Nachzahlung/Gutschrift)</span></strong>.</p><p><strong>Zahlungshinweis:</strong> Im Falle einer Nachzahlung bitten wir Sie, den ausstehenden Betrag innerhalb von 30 Tagen auf unser bekanntes Vermieterkonto unter Angabe des Verwendungszwecks zu überweisen. Eine etwaige Gutschrift wird mit der nächsten fälligen Mietzahlung verrechnet oder auf Ihr uns bekanntes Konto ausgezahlt.</p><p>Die detaillierte Aufteilung der einzelnen Kostenpositionen, der Umlageschlüssel und der Berechnungsschritte können Sie dem beigefügten Berechnungsblatt (Seite 2) entnehmen.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-body"><p style="font-size: 12pt; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Betriebskostenabrechnung: Berechnungsblatt</p><p>Nachfolgend finden Sie die detaillierte Aufstellung der Betriebskosten, die Umlageschlüssel und die Berechnungsschritte für Ihren Nutzungszeitraum:</p><p><span data-type="mention" data-id="nebenkosten_detail_tabelle" data-label="Detaillierte Umlagetabelle">Detaillierte Umlagetabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    fewo_invoice: {
        name: 'Fewo-Rechnung',
        category: 'FEWO-Rechnungen',
        subject: 'Rechnung über erbrachte Leistungen für Ihren Aufenthalt',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="gast_name" data-label="Gast-Name">Gast-Name</span></strong><br><span data-type="mention" data-id="gast_adresse" data-label="Gast-Adresse">Gast-Adresse</span></div><div class="letter-date" style="text-align: right; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 10pt; line-height: 1.4;">Nummer: <strong><span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></strong><br>Datum: <strong><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></strong><br>Zeitraum: <strong><span data-type="mention" data-id="buchungszeitraum" data-label="Buchungszeitraum">Buchungszeitraum</span></strong></div></div><div class="letter-subject">Rechnung Nr. <span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></div><div class="letter-body"><p>Sehr geehrte Damen und Herren,</p><p>wir bedanken uns herzlich für Ihren Aufenthalt in unserem Hause. Vereinbarungsgemäß erlauben wir uns, Ihnen die erbrachten Leistungen in Rechnung zu stellen:</p><p><span data-type="mention" data-id="positions_tabelle" data-label="Rechnungspositionen-Tabelle">Rechnungspositionen-Tabelle</span></p><p>Bitte überweisen Sie den fälligen Gesamtbetrag innerhalb von 14 Tagen auf unser angegebenes Bankkonto.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    fewo_credit_note: {
        name: 'Fewo-Gutschrift',
        category: 'FEWO-Rechnungen',
        subject: 'Gutschrift zu Ihrem Aufenthalt',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="gast_name" data-label="Gast-Name">Gast-Name</span></strong><br><span data-type="mention" data-id="gast_adresse" data-label="Gast-Adresse">Gast-Adresse</span></div><div class="letter-date" style="text-align: right; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 10pt; line-height: 1.4;">Nummer: <strong><span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></strong><br>Datum: <strong><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></strong><br>Zeitraum: <strong><span data-type="mention" data-id="buchungszeitraum" data-label="Buchungszeitraum">Buchungszeitraum</span></strong></div></div><div class="letter-subject">Gutschrift Nr. <span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></div><div class="letter-body"><p>Sehr geehrte Damen und Herren,</p><p>vereinbarungsgemäß erhalten Sie nachfolgend die Gutschrift für Ihren Aufenthalt bzw. Ihre Buchung:</p><p><span data-type="mention" data-id="positions_tabelle" data-label="Rechnungspositionen-Tabelle">Rechnungspositionen-Tabelle</span></p><p>Der Gutschriftbetrag wird Ihrem Konto in den nächsten Tagen gutgeschrieben oder vereinbarungsgemäß verrechnet.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
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
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Mieterhöhung für Ihr Mietobjekt gemäß § 558 BGB</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>gemäß § 558 BGB möchte ich Sie um Ihre Zustimmung zu einer Anpassung der Nettokaltmiete für die von Ihnen bewohnte Wohnung im Mietobjekt <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>) bitten.</p><p>Ihre aktuelle Nettokaltmiete beträgt derzeit monatlich <strong><span data-type="mention" data-id="aktuelle_miete" data-label="Aktuelle Miete">Aktuelle Miete</span></strong>. Dieser Betrag liegt unterhalb der ortsüblichen Vergleichsmiete für vergleichbaren Wohnraum in unserer Region, welche derzeit laut geltendem Mietspiegel ca. 7,46 € bis 9,05 €/m² entspricht.</p><p>Da die Miete seit mindestens 15 Monaten unverändert geblieben ist und die Erhöhung innerhalb der letzten 3 Jahre die gesetzliche Kappungsgrenze von 20% nicht überschreitet, sind die gesetzlichen Voraussetzungen für eine Anpassung erfüllt.</p><p>Wir passen die Nettokaltmiete hiermit um einen Erhöhungsbetrag von <strong><span data-type="mention" data-id="erhoehungs_betrag" data-label="Erhöhungsbetrag">Erhöhungsbetrag</span></strong> an, woraus sich ab dem <strong><span data-type="mention" data-id="erhoehungs_datum" data-label="Wirksamkeitsdatum">Wirksamkeitsdatum</span></strong> eine neue Nettokaltmiete von monatlich <strong><span data-type="mention" data-id="neue_miete" data-label="Neue Miete">Neue Miete</span></strong> ergibt.</p><p>Der neue Gesamtbetrag (Nettokaltmiete zzgl. Nebenkostenvorauszahlungen) ist ab dem Wirksamkeitsdatum zu entrichten. Wir bitten Sie höflich, die beiliegende Zustimmungserklärung unterschrieben bis zum <strong><span data-type="mention" data-id="zustimmungs_frist" data-label="Zustimmungsfrist">Zustimmungsfrist</span></strong> an uns zurückzusenden. Bitte beachten Sie, dass Sie gesetzlich ein zweimonatiges Sonderkündigungsrecht nach § 561 BGB besitzen.</p><p>Für Rückfragen stehen wir Ihnen gerne zur Verfügung.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
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

const LetterNavigation = Extension.create({
    name: 'letterNavigation',
    addKeyboardShortcuts() {
        // Collect all logical letter sections in document sequence
        const getSections = (doc) => {
            const sections = [];
            doc.descendants((node, pos) => {
                const type = node.type.name;
                if (['letterSender', 'letterRecipient', 'letterDate', 'letterSubject', 'letterObject', 'letterBody'].includes(type)) {
                    sections.push({
                        type,
                        pos,
                        end: pos + node.nodeSize,
                        node
                    });
                    return false; // don't descend
                }
            });
            return sections;
        };

        const isAtStartOfSection = ($pos, section) => {
            if (section.type === 'letterBody') {
                const parent = $pos.parent;
                return section.node.firstChild === parent && $pos.parentOffset === 0;
            }
            return $pos.parentOffset === 0;
        };

        const isAtEndOfSection = ($pos, section) => {
            if (section.type === 'letterBody') {
                const parent = $pos.parent;
                return section.node.lastChild === parent && $pos.parentOffset === parent.content.size;
            }
            return $pos.parentOffset === $pos.parent.content.size;
        };

        return {
            Backspace: ({ editor }) => {
                const { state, view } = editor;
                const { selection } = state;
                if (!selection.empty) return false;
                
                const $pos = selection.$anchor;
                const sections = getSections(state.doc);
                const activeIndex = sections.findIndex(s => $pos.pos >= s.pos && $pos.pos <= s.end);
                
                if (activeIndex > 0) {
                    const activeSection = sections[activeIndex];
                    if (isAtStartOfSection($pos, activeSection)) {
                        const prevSection = sections[activeIndex - 1];
                        let targetPos = prevSection.type === 'letterBody' 
                            ? prevSection.end - 2 
                            : prevSection.end - 1;
                            
                        if (targetPos >= 0 && targetPos <= state.doc.content.size) {
                            const tr = state.tr.setSelection(state.selection.constructor.near(state.doc.resolve(targetPos), -1));
                            view.dispatch(tr.scrollIntoView());
                            return true;
                        }
                    }
                }
                return false;
            },
            Enter: ({ editor }) => {
                const { state, view } = editor;
                const { selection } = state;
                const $pos = selection.$anchor;
                const sections = getSections(state.doc);
                const activeIndex = sections.findIndex(s => $pos.pos >= s.pos && $pos.pos <= s.end);
                
                if (activeIndex !== -1 && activeIndex < sections.length - 1) {
                    const activeSection = sections[activeIndex];
                    if (['letterSender', 'letterRecipient', 'letterDate', 'letterSubject', 'letterObject'].includes(activeSection.type)) {
                        const nextSection = sections[activeIndex + 1];
                        let targetPos = nextSection.type === 'letterBody'
                            ? nextSection.pos + 2
                            : nextSection.pos + 1;
                            
                        if (targetPos >= 0 && targetPos <= state.doc.content.size) {
                            const tr = state.tr.setSelection(state.selection.constructor.near(state.doc.resolve(targetPos), 1));
                            view.dispatch(tr.scrollIntoView());
                            return true;
                        }
                    }
                }
                return false;
            },
            ArrowUp: ({ editor }) => {
                const { state, view } = editor;
                const { selection } = state;
                if (!selection.empty) return false;
                
                const $pos = selection.$anchor;
                const sections = getSections(state.doc);
                const activeIndex = sections.findIndex(s => $pos.pos >= s.pos && $pos.pos <= s.end);
                
                if (activeIndex > 0) {
                    const activeSection = sections[activeIndex];
                    if (isAtStartOfSection($pos, activeSection)) {
                        const prevSection = sections[activeIndex - 1];
                        let targetPos = prevSection.type === 'letterBody' 
                            ? prevSection.end - 2 
                            : prevSection.end - 1;
                            
                        if (targetPos >= 0 && targetPos <= state.doc.content.size) {
                            const tr = state.tr.setSelection(state.selection.constructor.near(state.doc.resolve(targetPos), -1));
                            view.dispatch(tr.scrollIntoView());
                            return true;
                        }
                    }
                }
                return false;
            },
            ArrowDown: ({ editor }) => {
                const { state, view } = editor;
                const { selection } = state;
                if (!selection.empty) return false;
                
                const $pos = selection.$anchor;
                const sections = getSections(state.doc);
                const activeIndex = sections.findIndex(s => $pos.pos >= s.pos && $pos.pos <= s.end);
                
                if (activeIndex !== -1 && activeIndex < sections.length - 1) {
                    const activeSection = sections[activeIndex];
                    if (isAtEndOfSection($pos, activeSection)) {
                        const nextSection = sections[activeIndex + 1];
                        let targetPos = nextSection.type === 'letterBody'
                            ? nextSection.pos + 2
                            : nextSection.pos + 1;
                            
                        if (targetPos >= 0 && targetPos <= state.doc.content.size) {
                            const tr = state.tr.setSelection(state.selection.constructor.near(state.doc.resolve(targetPos), 1));
                            view.dispatch(tr.scrollIntoView());
                            return true;
                        }
                    }
                }
                return false;
            }
        };
    }
});

const createLayoutNode = (name, className, allowedContent) => Node.create({
    name,
    group: 'block',
    content: allowedContent,
    defining: true,
    addAttributes() {
        return {
            class: {
                default: className,
                parseHTML: element => {
                    const cls = element.getAttribute('class') || '';
                    return cls.includes(className) ? className : null;
                },
                renderHTML: attributes => {
                    return { class: `layout-div ${attributes.class || className}` };
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
                getAttrs: node => node.classList.contains(className) && {
                    class: node.getAttribute('class'),
                    style: node.getAttribute('style')
                }
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ['div', HTMLAttributes, 0];
    }
});

const LetterPage = createLayoutNode('letterPage', 'letter-page', 'block+');
const LetterSender = createLayoutNode('letterSender', 'letter-sender', 'inline*');
const LetterHeaderRow = createLayoutNode('letterHeaderRow', 'letter-header-row', 'block+');
const LetterRecipient = createLayoutNode('letterRecipient', 'letter-recipient', 'inline*');
const LetterDate = createLayoutNode('letterDate', 'letter-date', 'inline*');
const LetterSubject = createLayoutNode('letterSubject', 'letter-subject', 'inline*');
const LetterObject = createLayoutNode('letterObject', 'letter-object', 'inline*');

// LetterBody: isolating = true verhindert, dass Enter-Drücken Absätze
// außerhalb des Body in die Seitenebene "auslaufen" lässt.
const LetterBody = Node.create({
    name: 'letterBody',
    group: 'block',
    content: 'block+',
    defining: true,
    isolating: true,
    addAttributes() {
        return {
            class: {
                default: 'letter-body',
                parseHTML: element => {
                    const cls = element.getAttribute('class') || '';
                    return cls.includes('letter-body') ? 'letter-body' : null;
                },
                renderHTML: attributes => {
                    return { class: `layout-div ${attributes.class || 'letter-body'}` };
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
        return [{ tag: 'div', getAttrs: node => node.classList.contains('letter-body') && {
            class: node.getAttribute('class'),
            style: node.getAttribute('style')
        }}];
    },
    renderHTML({ HTMLAttributes }) { return ['div', HTMLAttributes, 0]; }
});

// LetterFooter: isolating = true verhindert, dass die Fußzeile
// durch Cursor-Bewegungen oder Pagination verschoben wird.
const LetterFooter = Node.create({
    name: 'letterFooter',
    group: 'block',
    content: 'block+',
    defining: true,
    isolating: true,
    addAttributes() {
        return {
            class: {
                default: 'letter-footer',
                parseHTML: element => {
                    const cls = element.getAttribute('class') || '';
                    return cls.includes('letter-footer') ? 'letter-footer' : null;
                },
                renderHTML: attributes => {
                    return { class: `layout-div ${attributes.class || 'letter-footer'}` };
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
        return [{ tag: 'div', getAttrs: node => node.classList.contains('letter-footer') && {
            class: node.getAttribute('class'),
            style: node.getAttribute('style')
        }}];
    },
    renderHTML({ HTMLAttributes }) { return ['div', HTMLAttributes, 0]; }
});

const FooterCol = createLayoutNode('footerCol', 'footer-col', 'inline*');

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
    const location = useLocation();
    const [activeType, setActiveType] = useState(() => {
        return location.state?.templateId || 'payment_reminder';
    });
    const [previewPage, setPreviewPage] = useState(1);
    const [pageCount, setPageCount] = useState(1);
    const [subject, setSubject] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selectedVariable, setSelectedVariable] = useState(null);
    const [selectedNodeType, setSelectedNodeType] = useState(null);
    const [showLivePreview, setShowLivePreview] = useState(false);
    const [showLayoutOutlines, setShowLayoutOutlines] = useState(false);
    const [layoutPopover, setLayoutPopover] = useState(null);
    const [diagnostics, setDiagnostics] = useState({
        lastError: null,
        loadSource: 'Initial',
        dbDataFound: false,
        contentLength: 0
    });

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
            StarterKit.configure({
                horizontalRule: false,
            }),
            LetterNavigation,
            LetterPage,
            LetterSender,
            LetterHeaderRow,
            LetterRecipient,
            LetterDate,
            LetterSubject,
            LetterObject,
            LetterBody,
            LetterFooter,
            FooterCol,
            Underline,
            TextAlign.configure({
                types: ['heading', 'paragraph'],
                alignments: ['left', 'center', 'right', 'justify'],
            }),
            TextStyle,
            Color,
            Mention.extend({
                draggable: true,
                renderHTML({ node, HTMLAttributes }) {
                    const id = node.attrs.id;
                    const label = node.attrs.label || id;
                    
                    const makeMockTable = (headers, rows, totalLabel, totalVal) => {
                        const tableStyle = "display: table; width: 100%; border-collapse: collapse; margin: 8px 0; border: 1px solid #bae6fd; background: #ffffff; color: #0369a1;";
                        const headerRowStyle = "display: table-row; background-color: #bae6fd; font-weight: bold; color: #0369a1; border-bottom: 2px solid #bae6fd;";
                        const rowStyle = "display: table-row; border-bottom: 1px solid #bae6fd;";
                        const altRowStyle = "display: table-row; border-bottom: 1px solid #bae6fd; background-color: #f0f9ff;";
                        const headerCellStyle = "display: table-cell; padding: 6px; border: 1px solid #bae6fd; font-size: 9pt; text-align: left;";
                        const cellStyle = "display: table-cell; padding: 6px; border: 1px solid #bae6fd; font-size: 9pt; text-align: left; color: #334155;";
                        
                        const children = [
                            ['span', { style: headerRowStyle }, 
                                ...headers.map(h => ['span', { style: headerCellStyle }, h])
                            ],
                            ...rows.map((row, idx) => 
                                ['span', { style: idx % 2 === 1 ? altRowStyle : rowStyle },
                                    ...row.map((cell, cidx) => {
                                        const isLastCol = cidx === row.length - 1;
                                        const align = isLastCol ? 'right' : 'left';
                                        const font = isLastCol ? 'font-weight: bold;' : '';
                                        return ['span', { style: cellStyle + ` text-align: ${align}; ${font}` }, cell];
                                    })
                                ]
                            )
                        ];

                        if (totalLabel && totalVal) {
                            const totalRowStyle = "display: table-row; font-weight: bold; background-color: #e0f2fe; color: #0369a1;";
                            const labelColSpanStyle = `display: table-cell; padding: 6px; border: 1px solid #bae6fd; font-size: 9pt; text-align: right;`;
                            const valStyle = `display: table-cell; padding: 6px; border: 1px solid #bae6fd; font-size: 9pt; text-align: right; color: #0284c7;`;
                            
                            children.push(['span', { style: totalRowStyle },
                                ['span', { style: labelColSpanStyle }, totalLabel],
                                ...Array(headers.length - 2).fill(null).map(() => ['span', { style: "display: table-cell; border: 1px solid #bae6fd;" }]),
                                ['span', { style: valStyle }, totalVal]
                            ]);
                        }

                        return ['span', { style: tableStyle }, ...children];
                    };

                    const MOCK_VALUES = {
                        mieter_name: "Max Mustermann",
                        mieter_nachname: "Mustermann",
                        mieter_anrede: "Sehr geehrter Herr Mustermann",
                        mieter_adresse: "Musterweg 12\n12345 Musterstadt",
                        gast_name: "Dr. Sabine Sommer",
                        gast_adresse: "Lindenallee 7\n50667 Köln",
                        objekt_name: "Wohnpark Sonnenseite",
                        einheit_name: "Wohnung EG links",
                        objekt_adresse: "Musterstraße 42, 12345 Musterstadt",
                        vermieter_name: "ImmoControlpro Vermieter GmbH",
                        vermieter_bankverbindung: "Sparkasse Musterstadt\nIBAN: DE89 5005 0400 1122 3344 55\nBIC: SOLODEM1MUC",
                        vermieter_adresse: "Musterstraße 42, 12345 Musterstadt",
                        vermieter_email: "info@vermieter.de",
                        vermieter_telefon: "0123 4567890",
                        vermieter_steuernummer: "123/456/78901",
                        vermieter_ust_id: "DE123456789",
                        offener_betrag: "908,70 €",
                        zahlungsfrist_datum: "17.06.2026",
                        verzugstage: "14",
                        mahnstufe: "2",
                        zinsbetrag: "3,70 €",
                        abrechnungsjahr: "2025",
                        abrechnungszeitraum: "01.01.2025 - 31.12.2025",
                        nutzungszeitraum: "01.01.2025 - 31.12.2025",
                        gesamtkosten_mieter: "550,00 €",
                        vorauszahlungs_betrag: "400,00 €",
                        saldo_betrag: "150,00 €",
                        saldo_art: "Nachzahlung",
                        kaution_betrag: "1.950,00 €",
                        buchungszeitraum: "15.05.2026 - 22.05.2026",
                        gaeste_anzahl: "2",
                        rechnungsnummer: "RE-2026-0412",
                        rechnungsdatum: "03.06.2026",
                        rechnungs_datum: "03.06.2026",
                        erstellungsdatum: "03.06.2026",
                        netto_betrag: "560,75 €",
                        mwst_betrag: "39,25 €",
                        brutto_betrag: "600,00 €",
                        original_rechnungsnummer: "RE-2026-0399",
                        storno_nummer: "ST-2026-0001",
                        aktuelle_miete: "650,00 €",
                        neue_miete: "715,00 €",
                        erhoehungs_betrag: "65,00 €",
                        erhoehungs_datum: "01.08.2026",
                        zustimmungs_frist: "31.07.2026",
                        einzug_datum: "01.06.2026"
                    };

                    // Tables
                    if (id === 'forderungs_tabelle' || id === 'forderungs_detail_tabelle') {
                        const headers = ['Fälligkeit', 'Bezeichnung', 'Soll-Betrag', 'Ist-Betrag', 'Offen'];
                        const rows = [
                            ['04.05.2026', 'Grundmiete + NK-Vorauszahlung Mai 2026', '850,00 €', '0,00 €', '850,00 €'],
                            ['04.05.2026', 'Mahngebühr Stufe 1', '5,00 €', '0,00 €', '5,00 €']
                        ];
                        return [
                            'span',
                            { class: 'variable-chip expanded-variable-table', 'data-type': 'mention', 'data-id': id, 'data-label': label, contenteditable: 'false', title: `Platzhalter: ${label}` },
                            makeMockTable(headers, rows, 'Gesamtrückstand:', '855,00 €')
                        ];
                    }
                    
                    if (id === 'nebenkosten_tabelle') {
                        const headers = ['Kostenart', 'Gesamtkosten', 'Umlageschlüssel', 'Mieteranteil'];
                        const rows = [
                            ['Grundsteuer', '1.200,00 €', 'Wohnfläche (100/1000)', '120,00 €'],
                            ['Heizkosten', '4.500,00 €', 'Verbrauch (850/9000)', '425,00 €']
                        ];
                        return [
                            'span',
                            { class: 'variable-chip expanded-variable-table', 'data-type': 'mention', 'data-id': id, 'data-label': label, contenteditable: 'false', title: `Platzhalter: ${label}` },
                            makeMockTable(headers, rows, 'Summe Anteil:', '545,00 €')
                        ];
                    }

                    if (id === 'positions_tabelle') {
                        const headers = ['Pos', 'Beschreibung', 'Betrag'];
                        const rows = [
                            ['1', 'Ferienwohnung Buchung (7 Nächte)', '500,00 €'],
                            ['2', 'Endreinigung Pauschale', '60,00 €']
                        ];
                        return [
                            'span',
                            { class: 'variable-chip expanded-variable-table', 'data-type': 'mention', 'data-id': id, 'data-label': label, contenteditable: 'false', title: `Platzhalter: ${label}` },
                            makeMockTable(headers, rows, 'Gesamt:', '560,00 €')
                        ];
                    }

                    // Multiline Text/Addresses
                    if (id === 'mieter_adresse' || id === 'gast_adresse' || id === 'vermieter_bankverbindung') {
                        return [
                            'span',
                            { class: 'variable-chip multiline-variable', 'data-type': 'mention', 'data-id': id, 'data-label': label, contenteditable: 'false', title: `Platzhalter: ${label}` },
                            MOCK_VALUES[id]
                        ];
                    }

                    // All other variables mapped to mock values
                    if (MOCK_VALUES[id] !== undefined) {
                        return [
                            'span',
                            { class: 'variable-chip', 'data-type': 'mention', 'data-id': id, 'data-label': label, contenteditable: 'false', title: `Platzhalter: ${label}` },
                            MOCK_VALUES[id]
                        ];
                    }

                    // Fallback to default styling
                    return [
                        'span',
                        { class: 'variable-chip', 'data-type': 'mention', 'data-id': id, 'data-label': label, contenteditable: 'false' },
                        `${label}`
                    ];
                }
            }),
            HorizontalRule.extend({
                draggable: true,
                selectable: true,
                addAttributes() {
                    return {
                        style: {
                            default: null,
                            parseHTML: element => element.getAttribute('style'),
                            renderHTML: attributes => {
                                if (!attributes.style) return {};
                                return { style: attributes.style };
                            }
                        },
                        class: {
                            default: 'editor-hr',
                            parseHTML: element => element.getAttribute('class') || 'editor-hr',
                            renderHTML: attributes => {
                                return { class: attributes.class || 'editor-hr' };
                            }
                        }
                    };
                }
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
                if (node.type.name === 'letterPage') {
                    count++;
                }
            });
            setPageCount(count > 0 ? count : 1);
        },
        onSelectionUpdate({ editor }) {
            const node = editor.state.selection?.node;
            setSelectedNodeType(node?.type?.name || null);
        },
        editorProps: {
            // Seitenübergreifende Delete/Backspace-Handler
            // Seiten verhalten sich wie EIN Dokument – nur optisch in A4 geteilt
            handleKeyDown(view, event) {
                const { state } = view;
                const { selection, doc } = state;
                const pos = selection.from;
                
                // Finde die aktuelle letterBody und letterPage
                const $pos = doc.resolve(pos);
                let bodyNode = null, bodyPos = -1, pageNode = null, pagePos = -1;
                for (let d = $pos.depth; d >= 0; d--) {
                    const node = $pos.node(d);
                    if (node.type.name === 'letterBody') {
                        bodyNode = node;
                        bodyPos = $pos.before(d);
                    }
                    if (node.type.name === 'letterPage') {
                        pageNode = node;
                        pagePos = $pos.before(d);
                        break;
                    }
                }
                
                if (!bodyNode || !pageNode) return false;
                
                // DELETE am Ende des Body → Text von nächster Seite holen
                if (event.key === 'Delete' && !event.shiftKey && !event.ctrlKey) {
                    const bodyEnd = bodyPos + bodyNode.nodeSize;
                    const isAtEnd = pos >= bodyEnd - 2; // Cursor am oder nahe dem Ende
                    
                    if (isAtEnd) {
                        // Finde die nächste Seite
                        const pages = [];
                        doc.forEach((node, offset) => {
                            if (node.type.name === 'letterPage') {
                                pages.push({ node, pos: offset });
                            }
                        });
                        
                        const currentPageIdx = pages.findIndex(p => p.pos === pagePos);
                        if (currentPageIdx >= 0 && currentPageIdx + 1 < pages.length) {
                            const nextPageData = pages[currentPageIdx + 1];
                            const nextPage = nextPageData.node;
                            const nextPagePos = nextPageData.pos;
                            
                            // Strukturelle Typen
                            const structuralTypes = ['letterBody', 'letterFooter', 'letterSender', 
                                'letterSubject', 'letterObject', 'letterHeaderRow', 'letterRecipient', 'letterDate'];
                            
                            // Prüfe ob erstes Kind ein Seiten-Level-Absatz ist
                            const firstChild = nextPage.firstChild;
                            if (firstChild && !structuralTypes.includes(firstChild.type.name)) {
                                // Seiten-Level-Absatz → in aktuelle Body verschieben
                                const fcStart = nextPagePos + 1;
                                const fcEnd = fcStart + firstChild.nodeSize;
                                const tr = state.tr;
                                tr.insert(bodyEnd - 1, firstChild.copy(firstChild.content));
                                tr.delete(tr.mapping.map(fcStart), tr.mapping.map(fcEnd));
                                view.dispatch(tr);
                                return true;
                            }
                            
                            // Prüfe Body der nächsten Seite
                            let nextBodyNode = null, nextBodyPos = -1;
                            nextPage.forEach((child, offset) => {
                                if (child.type.name === 'letterBody') {
                                    nextBodyNode = child;
                                    nextBodyPos = nextPagePos + 1 + offset;
                                }
                            });
                            
                            if (nextBodyNode && nextBodyNode.childCount > 0) {
                                const firstBodyChild = nextBodyNode.firstChild;
                                const fcStart = nextBodyPos + 1;
                                const fcEnd = fcStart + firstBodyChild.nodeSize;
                                const tr = state.tr;
                                tr.insert(bodyEnd - 1, firstBodyChild.copy(firstBodyChild.content));
                                tr.delete(tr.mapping.map(fcStart), tr.mapping.map(fcEnd));
                                view.dispatch(tr);
                                return true;
                            }
                        }
                    }
                }
                
                // BACKSPACE am Anfang eines Absatzes → Text zur vorherigen Seite verschieben / mergen
                if (event.key === 'Backspace' && !event.shiftKey && !event.ctrlKey) {
                    const $pos = doc.resolve(pos);
                    
                    // Cursor muss am Anfang eines Blocks stehen
                    if ($pos.parentOffset !== 0) return false;
                    
                    const parentPos = $pos.before($pos.depth);
                    
                    // Prüfe ob dieser Absatz der ERSTE im Body ist
                    const isFirstInBody = bodyNode && (parentPos === bodyPos + 1);
                    
                    if (!isFirstInBody) return false;
                    
                    // Finde alle Seiten
                    const pages = [];
                    doc.forEach((node, offset) => {
                        if (node.type.name === 'letterPage') {
                            pages.push({ node, pos: offset });
                        }
                    });
                    
                    const currentPageIdx = pages.findIndex(p => p.pos === pagePos);
                    if (currentPageIdx <= 0) return false; // Seite 1 → normales Backspace
                    
                    const prevPageData = pages[currentPageIdx - 1];
                    const prevPage = prevPageData.node;
                    const prevPagePos = prevPageData.pos;
                    
                    // Finde Body der vorherigen Seite
                    let prevBodyNode = null, prevBodyPos = -1;
                    prevPage.forEach((child, offset) => {
                        if (child.type.name === 'letterBody') {
                            prevBodyNode = child;
                            prevBodyPos = prevPagePos + 1 + offset;
                        }
                    });
                    
                    if (prevBodyNode && bodyNode && bodyNode.childCount > 0) {
                        try {
                            const firstChild = bodyNode.firstChild;
                            const fcStart = bodyPos + 1;
                            const fcEnd = fcStart + firstChild.nodeSize;
                            const tr = state.tr;
                            
                            // Finde das letzte Kind des vorherigen Body
                            let lastChildNode = null;
                            let lastChildOffset = -1;
                            prevBodyNode.forEach((child, offset) => {
                                lastChildNode = child;
                                lastChildOffset = offset;
                            });
                            
                            let targetCursorPos = -1;
                            
                            if (lastChildNode && lastChildNode.type.name === 'paragraph' && firstChild.type.name === 'paragraph') {
                                // Beide sind Absätze -> Mergen!
                                const lastChildEnd = prevBodyPos + 1 + lastChildOffset + lastChildNode.nodeSize - 1;
                                
                                // Füge den Inhalt des ersten Absatzes am Ende des letzten Absatzes ein
                                tr.insert(lastChildEnd, firstChild.content);
                                
                                // Lösche den originalen ersten Absatz auf Seite 2
                                tr.delete(tr.mapping.map(fcStart), tr.mapping.map(fcEnd));
                                
                                // Cursor an die Stelle des Merges setzen (Ende des ursprünglichen letzten Absatzes)
                                targetCursorPos = tr.mapping.map(lastChildEnd);
                            } else {
                                // Unterschiedliche Typen oder kein Absatz -> Absatz verschieben (als neues Kind)
                                const prevBodyEnd = prevBodyPos + prevBodyNode.nodeSize;
                                
                                // Absatz ans Ende des vorherigen Body einfügen
                                tr.insert(prevBodyEnd - 1, firstChild.copy(firstChild.content));
                                
                                // Lösche den originalen Absatz
                                tr.delete(tr.mapping.map(fcStart), tr.mapping.map(fcEnd));
                                
                                // Cursor an den Anfang des verschobenen Absatzes setzen
                                targetCursorPos = tr.mapping.map(prevBodyEnd - 1) + 1;
                            }
                            
                            // Cursor-Positionierung
                            if (targetCursorPos !== -1) {
                                try {
                                    const $mapped = tr.doc.resolve(targetCursorPos);
                                    const sel = Selection.near($mapped, -1);
                                    tr.setSelection(sel);
                                } catch(e) {
                                    console.warn('Could not set selection near targetCursorPos:', e);
                                }
                            }
                            
                            view.dispatch(tr);
                            return true;
                        } catch (e) {
                            console.error('Backspace cross-page error:', e);
                        }
                    }
                }
                
                return false;
            },
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
                    } catch {
                        // ignore error
                    }
                }
                return false;
            }
        }
    });

    useEffect(() => {
        if (editor) {
            editor.setOptions({
                editorProps: {
                    attributes: {
                        class: showLayoutOutlines ? 'show-outlines' : '',
                    }
                }
            });
        }
        if (!showLayoutOutlines) setLayoutPopover(null);
    }, [editor, showLayoutOutlines]);

    // ── Layout-Popover: Klick auf Bereich zeigt Abstands-Editor ──
    const sectionLabels = {
        'letter-sender': 'Absenderzeile', 'letter-recipient': 'Empfängeradresse',
        'letter-date': 'Ort / Datum', 'letter-subject': 'Betreffzeile',
        'letter-object': 'Objekt / Details', 'letter-body': 'Brieftext / Inhalt',
        'letter-footer': 'Fußzeile', 'letter-header-row': 'Kopfzeile-Spalten',
        'footer-col': 'Spalte Fußzeile'
    };
    const classToNodeType = {
        'letter-sender': 'letterSender', 'letter-recipient': 'letterRecipient',
        'letter-date': 'letterDate', 'letter-subject': 'letterSubject',
        'letter-object': 'letterObject', 'letter-body': 'letterBody',
        'letter-footer': 'letterFooter', 'letter-header-row': 'letterHeaderRow',
        'footer-col': 'footerCol'
    };

    const parseStyleStr = (s) => {
        if (!s) return {};
        const r = {};
        s.split(';').forEach(rule => {
            const [p, v] = rule.split(':').map(x => x.trim());
            if (p && v) r[p] = v;
        });
        return r;
    };
    const buildStyleStr = (obj) => Object.entries(obj)
        .filter(([_, v]) => v && v !== '0mm')
        .map(([k, v]) => `${k}: ${v}`).join('; ') || null;

    const updateLayoutStyle = (property, value) => {
        if (!layoutPopover || layoutPopover.nodePos < 0 || !editor) return;
        const node = editor.state.doc.nodeAt(layoutPopover.nodePos);
        if (!node) return;
        const styles = parseStyleStr(node.attrs.style);
        if (value > 0) styles[property] = `${value}mm`;
        else delete styles[property];
        const tr = editor.state.tr.setNodeMarkup(layoutPopover.nodePos, null, {
            ...node.attrs, style: buildStyleStr(styles)
        });
        editor.view.dispatch(tr);
        const propKey = property === 'margin-top' ? 'marginTop' :
            property === 'margin-bottom' ? 'marginBottom' :
            property === 'height' ? 'height' : 'width';
        setLayoutPopover(prev => ({
            ...prev, styles: { ...prev.styles, [propKey]: value }
        }));
    };

    const canMoveNode = (pos, direction) => {
        if (!editor) return false;
        try {
            const $pos = editor.state.doc.resolve(pos);
            const parent = $pos.parent;
            if (parent.type.name !== 'letterPage') return false;
            const index = $pos.index();
            const targetIndex = index + direction;
            return targetIndex >= 0 && targetIndex < parent.childCount;
        } catch(e) {
            return false;
        }
    };

    const moveLayoutNode = (pos, direction) => {
        if (!editor) return;
        const state = editor.state;
        try {
            const $pos = state.doc.resolve(pos);
            const node = state.doc.nodeAt(pos);
            if (!node) return;
            const parent = $pos.parent;
            const index = $pos.index();
            const targetIndex = index + direction;
            if (targetIndex < 0 || targetIndex >= parent.childCount) return;
            
            const targetNode = parent.child(targetIndex);
            const tr = state.tr;
            const nodeSize = node.nodeSize;
            const parentStart = $pos.start($pos.depth);
            
            let currentPos = parentStart;
            let nodeOffset = -1;
            let targetOffset = -1;
            
            for (let i = 0; i < parent.childCount; i++) {
                const child = parent.child(i);
                if (i === index) nodeOffset = currentPos;
                if (i === targetIndex) targetOffset = currentPos;
                currentPos += child.nodeSize;
            }
            
            if (nodeOffset === -1 || targetOffset === -1) return;
            
            if (direction === -1) {
                tr.delete(nodeOffset, nodeOffset + nodeSize);
                tr.insert(targetOffset, node);
                editor.view.dispatch(tr);
                setLayoutPopover(prev => prev ? { ...prev, nodePos: targetOffset } : null);
            } else {
                tr.delete(nodeOffset, nodeOffset + nodeSize);
                const insertPos = targetOffset - nodeSize + targetNode.nodeSize;
                tr.insert(insertPos, node);
                editor.view.dispatch(tr);
                setLayoutPopover(prev => prev ? { ...prev, nodePos: insertPos } : null);
            }
        } catch(e) {
            console.error('Error moving layout node:', e);
        }
    };

    const deleteLayoutNode = (pos) => {
        if (!editor) return;
        const state = editor.state;
        try {
            const node = state.doc.nodeAt(pos);
            if (!node) return;
            const tr = state.tr.delete(pos, pos + node.nodeSize);
            editor.view.dispatch(tr);
            setLayoutPopover(null);
        } catch(e) {
            console.error('Error deleting layout node:', e);
        }
    };

    const getPresentSections = () => {
        if (!editor) return {};
        const present = {};
        try {
            editor.state.doc.descendants((node) => {
                if (node.type.name === 'letterSender') present['letter-sender'] = true;
                if (node.type.name === 'letterHeaderRow') present['letter-header-row'] = true;
                if (node.type.name === 'letterSubject') present['letter-subject'] = true;
                if (node.type.name === 'letterObject') present['letter-object'] = true;
                if (node.type.name === 'letterBody') present['letter-body'] = true;
                if (node.type.name === 'letterFooter') present['letter-footer'] = true;
            });
        } catch(e) {
            console.error('Error getting present sections:', e);
        }
        return present;
    };

    const addSection = (secClass) => {
        if (!editor) return;
        const state = editor.state;
        try {
            const present = getPresentSections();
            if (present[secClass]) return;
            
            let nodeJson = { type: classToNodeType[secClass] };
            if (secClass === 'letter-sender') {
                nodeJson.content = [{ type: 'text', text: 'Absenderzeile (Bitte anpassen)' }];
            } else if (secClass === 'letter-header-row') {
                nodeJson.content = [
                    { type: 'letterRecipient', content: [{ type: 'text', text: 'Empfängeradresse' }] },
                    { type: 'letterDate', content: [{ type: 'text', text: 'Ort, den Datum' }] }
                ];
            } else if (secClass === 'letter-subject') {
                nodeJson.content = [{ type: 'text', text: 'Betreffzeile (Bitte anpassen)' }];
            } else if (secClass === 'letter-object') {
                nodeJson.content = [{ type: 'text', text: 'Betreffdetails / Objekt' }];
            } else if (secClass === 'letter-body') {
                nodeJson.content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Brieftext...' }] }];
            } else if (secClass === 'letter-footer') {
                nodeJson.content = [
                    { type: 'footerCol', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Spalte 1' }] }] },
                    { type: 'footerCol', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Spalte 2' }] }] },
                    { type: 'footerCol', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Spalte 3' }] }] }
                ];
            }
            
            const node = state.schema.nodeFromJSON(nodeJson);
            const tr = state.tr;
            
            let pagePos = -1;
            state.doc.descendants((n, p) => {
                if (n.type.name === 'letterPage') {
                    pagePos = p;
                    return false;
                }
            });
            
            if (pagePos === -1) return;
            
            const pageNode = state.doc.nodeAt(pagePos);
            const parentStart = pagePos + 1;
            const order = ['letterSender', 'letterHeaderRow', 'letterSubject', 'letterObject', 'letterBody', 'letterFooter'];
            const targetType = classToNodeType[secClass];
            const targetOrderIdx = order.indexOf(targetType);
            
            let insertOffset = 0;
            let inserted = false;
            
            for (let i = 0; i < pageNode.childCount; i++) {
                const child = pageNode.child(i);
                const childType = child.type.name;
                const childOrderIdx = order.indexOf(childType);
                
                if (childOrderIdx > targetOrderIdx) {
                    tr.insert(parentStart + insertOffset, node);
                    inserted = true;
                    break;
                }
                insertOffset += child.nodeSize;
            }
            
            if (!inserted) {
                tr.insert(parentStart + insertOffset, node);
            }
            
            editor.view.dispatch(tr);
        } catch(e) {
            console.error('Error adding layout section:', e);
        }
    };

    useEffect(() => {
        if (!editor || !showLayoutOutlines) return;
        const sectionClasses = Object.keys(sectionLabels);
        
        const pxToMm = (pxStr) => {
            if (!pxStr) return 0;
            const px = parseFloat(pxStr);
            if (isNaN(px)) return 0;
            return Math.round(px * 25.4 / 96);
        };

        const handleClick = (e) => {
            if (e.target.closest('.layout-popover')) return;
            const layoutDiv = e.target.closest('.layout-div');
            if (!layoutDiv || layoutDiv.classList.contains('letter-page')) {
                setLayoutPopover(null); return;
            }
            const secClass = sectionClasses.find(c => layoutDiv.classList.contains(c));
            if (!secClass) return;
            const typeName = classToNodeType[secClass];
            const styleObj = parseStyleStr(layoutDiv.getAttribute('style'));
            const computed = window.getComputedStyle(layoutDiv);
            
            try {
                const pos = editor.view.posAtDOM(layoutDiv, 0);
                const $pos = editor.state.doc.resolve(pos);
                let nodePos = -1;
                for (let d = $pos.depth; d >= 0; d--) {
                    if ($pos.node(d).type.name === typeName) {
                        nodePos = $pos.before(d); break;
                    }
                }
                
                setLayoutPopover({
                    secClass, typeName, label: sectionLabels[secClass], nodePos,
                    popupTop: Math.max(10, Math.min(e.clientY - 20, window.innerHeight - 250)),
                    popupLeft: Math.max(10, Math.min(e.clientX - 110, window.innerWidth - 230)),
                    styles: {
                        marginTop: parseFloat(styleObj['margin-top']) || pxToMm(computed.marginTop),
                        marginBottom: parseFloat(styleObj['margin-bottom']) || pxToMm(computed.marginBottom),
                        height: parseFloat(styleObj['height']) || pxToMm(computed.height),
                        width: parseFloat(styleObj['width']) || pxToMm(computed.width)
                    }
                });
            } catch(e) { console.error('Layout popover error:', e); }
        };
        editor.view.dom.addEventListener('click', handleClick);
        return () => editor.view.dom.removeEventListener('click', handleClick);
    }, [editor, showLayoutOutlines]);

    const getHrStyleValue = (property) => {
        if (!editor) return '';
        const selectedNode = editor.state.selection?.node;
        if (selectedNode?.type?.name === 'horizontalRule') {
            const styleStr = selectedNode.attrs.style || '';
            const styles = {};
            styleStr.split(';').forEach(s => {
                const parts = s.split(':');
                if (parts.length === 2) {
                    styles[parts[0].trim().toLowerCase()] = parts[1].trim();
                }
            });
            return styles[property.toLowerCase()] || '';
        }
        return '';
    };

    const updateHrStyle = (property, value) => {
        if (!editor) return;
        const selectedNode = editor.state.selection?.node;
        if (selectedNode?.type?.name === 'horizontalRule') {
            const styleStr = selectedNode.attrs.style || '';
            const styles = {};
            styleStr.split(';').forEach(s => {
                const parts = s.split(':');
                if (parts.length === 2) {
                    styles[parts[0].trim().toLowerCase()] = parts[1].trim();
                }
            });
            
            if (value === null || value === '') {
                delete styles[property.toLowerCase()];
            } else {
                styles[property.toLowerCase()] = value;
            }
            
            const newStyleStr = Object.entries(styles)
                .map(([k, v]) => `${k}: ${v}`)
                .join('; ');
                
            editor.commands.updateAttributes('horizontalRule', { style: newStyleStr });
        }
    };

    // Helper function to extract page nodes and positions
    const getPagesFromDoc = (doc) => {
        const pages = [];
        doc.forEach((node, pos) => {
            if (node.type.name === 'letterPage') {
                let bodyNode = null;
                let bodyPos = -1;
                let footerNode = null;
                let footerPos = -1;
                
                node.forEach((child, offset) => {
                    const childPos = pos + 1 + offset;
                    if (child.type.name === 'letterBody') {
                        bodyNode = child;
                        bodyPos = childPos;
                    } else if (child.type.name === 'letterFooter') {
                        footerNode = child;
                        footerPos = childPos;
                    }
                });
                
                pages.push({
                    node,
                    pos,
                    end: pos + node.nodeSize,
                    bodyNode,
                    bodyPos,
                    bodyEnd: bodyPos !== -1 ? bodyPos + bodyNode.nodeSize : -1,
                    footerNode,
                    footerPos
                });
            }
        });
        return pages;
    };

    // Word-like Pagination: overflow:hidden + scrollHeight check
    // Overflow → move LAST child to next page. Underflow → pull FIRST child back.
    const runPaginationStep = (editor) => {
        if (!editor || !editor.view || !editor.view.dom) return false;
        
        // DOM synchronisieren damit Messungen korrekt sind
        try { editor.view.updateState(editor.view.state); } catch(e) { /* ignore */ }
        
        const doc = editor.state.doc;
        const pages = getPagesFromDoc(doc);
        const domPages = document.querySelectorAll('.ProseMirror > .letter-page');
        
        if (pages.length === 0 || domPages.length !== pages.length) return false;
        
        // 1. Bereinigung: Verschiebe verwaiste Seiten-Level-Absätze und unzulässige Strukturelemente auf Folgeseiten
        const structuralTypes = ['letterBody', 'letterFooter', 'letterSender', 
            'letterSubject', 'letterObject', 'letterHeaderRow', 'letterRecipient', 'letterDate'];
            
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            if (page.bodyPos !== -1) {
                let hasOrphan = false;
                let orphanPos = -1;
                let orphanNode = null;
                let isSubjectOnFollowPage = false;
                
                page.node.forEach((child, offset) => {
                    // Auf Folgeseiten (Seite 2+) wandeln wir das letterSubject in einen fettgedruckten Paragraph im Body um.
                    if (i > 0 && child.type.name === 'letterSubject') {
                        isSubjectOnFollowPage = true;
                        orphanPos = page.pos + 1 + offset;
                        orphanNode = child;
                    } else if (!structuralTypes.includes(child.type.name)) {
                        hasOrphan = true;
                        orphanPos = page.pos + 1 + offset;
                        orphanNode = child;
                    }
                });
                
                if ((hasOrphan || isSubjectOnFollowPage) && orphanNode) {
                    try {
                        const tr = editor.state.tr;
                        let newNode = orphanNode;
                        
                        if (isSubjectOnFollowPage) {
                            // Wandle letterSubject in einen fettgedruckten Überschriften-Paragraph um
                            const styleStr = 'font-size: 12pt; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm; display: block;';
                            newNode = editor.schema.nodes.paragraph.create(
                                { style: styleStr },
                                orphanNode.content
                            );
                        } else {
                            newNode = orphanNode.copy(orphanNode.content);
                        }
                        
                        // Wenn es das Subject auf Folgeseiten oder vor dem Body liegt -> an den Anfang des Bodys
                        const isBeforeBody = orphanPos < page.bodyPos;
                        const insertPos = (isSubjectOnFollowPage || isBeforeBody) ? page.bodyPos + 1 : page.bodyEnd - 1;
                        
                        tr.insert(insertPos, newNode);
                        // Lösche das Original auf Seiten-Ebene
                        tr.delete(tr.mapping.map(orphanPos), tr.mapping.map(orphanPos + orphanNode.nodeSize));
                        editor.view.dispatch(tr);
                        return true; // Erneut paginieren
                    } catch (e) {
                        console.error('Error auto-fixing orphan/subject paragraph:', e);
                    }
                }
            }
        }
        
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const domPage = domPages[i];
            const domBody = domPage.querySelector('.letter-body');
            if (!domBody) continue;
            
            // OVERFLOW: scrollHeight > clientHeight = Content ist geclippt
            // Kein Toleranz-Puffer → Overflow triggert sofort beim ersten Enter
            const isOverflowing = domBody.scrollHeight > domBody.clientHeight;
            
            if (isOverflowing && page.bodyNode && page.bodyNode.childCount > 1) {
                const lastChild = page.bodyNode.lastChild;
                const lastChildEnd = page.bodyEnd - 1;
                const lastChildStart = lastChildEnd - lastChild.nodeSize;
                const nextIdx = i + 1;
                
                try {
                    if (nextIdx >= pages.length) {
                        // Keine nächste Seite → neue Seite erstellen
                        const footerClone = page.footerNode
                            ? editor.schema.nodes.letterFooter.create(null, page.footerNode.content)
                            : editor.schema.nodes.letterFooter.create(null, [editor.schema.nodes.paragraph.create()]);
                        const newPage = editor.schema.nodes.letterPage.create(null, [
                            editor.schema.nodes.letterBody.create(null, [lastChild.copy(lastChild.content)]),
                            footerClone
                        ]);
                        const tr = editor.state.tr;
                        tr.insert(page.end, newPage);
                        tr.delete(lastChildStart, lastChildEnd);
                        editor.view.dispatch(tr);
                        return true;
                    } else {
                        // Nächste Seite existiert → AM ANFANG des Bodys der nächsten Seite einfügen
                        // So bleibt der Text immer sauber innerhalb des Body-Elements gefangen
                        const nextPage = pages[nextIdx];
                        const tr = editor.state.tr;
                        const targetPos = nextPage.bodyPos !== -1 ? nextPage.bodyPos + 1 : nextPage.pos + 1;
                        
                        tr.insert(targetPos, lastChild.copy(lastChild.content));
                        tr.delete(lastChildStart, lastChildEnd);
                        editor.view.dispatch(tr);
                        return true;
                    }
                } catch (e) {
                    console.error('Pagination overflow error:', e);
                }
            }
            
            // Overflow mit nur einem Kind → kann nicht weiter aufgeteilt werden
            if (isOverflowing && page.bodyNode && page.bodyNode.childCount <= 1) continue;
            
            // UNDERFLOW: Prüfe ob Content von nächster Seite zurückpasst
            const nextIdx = i + 1;
            if (nextIdx < pages.length) {
                const nextPage = pages[nextIdx];
                const domNextPage = domPages[nextIdx];
                
                // Layout-Sync erzwingen für genaue Messungen
                domBody.offsetHeight;
                
                // Prüfe ob es Seiten-Level-Absätze gibt (vor Strukturelementen)
                // Diese wurden durch Overflow VOR Überschriften eingefügt
                const structuralTypes = ['letterBody', 'letterFooter', 'letterSender', 
                    'letterSubject', 'letterObject', 'letterHeaderRow', 'letterRecipient', 'letterDate'];
                const firstPageChild = nextPage.node.firstChild;
                const isPageLevelParagraph = firstPageChild && !structuralTypes.includes(firstPageChild.type.name);
                
                if (isPageLevelParagraph) {
                    // Seiten-Level-Absatz → zurückholen wenn Platz da ist
                    const firstDomChild = domNextPage?.firstElementChild;
                    if (firstDomChild) {
                        const childHeight = firstDomChild.getBoundingClientRect().height;
                        // Freien Platz berechnen: Abstand vom letzten Kind zum Body-Ende
                        const bodyRect = domBody.getBoundingClientRect();
                        const lastBodyChild = domBody.lastElementChild;
                        const contentBottom = lastBodyChild ? lastBodyChild.getBoundingClientRect().bottom : bodyRect.top;
                        const freeSpace = bodyRect.top + domBody.clientHeight - contentBottom;
                        
                        if (childHeight > 0 && childHeight <= freeSpace) {
                            try {
                                const fcStart = nextPage.pos + 1;
                                const fcEnd = fcStart + firstPageChild.nodeSize;
                                const tr = editor.state.tr;
                                tr.insert(page.bodyEnd - 1, firstPageChild.copy(firstPageChild.content));
                                tr.delete(tr.mapping.map(fcStart), tr.mapping.map(fcEnd));
                                editor.view.dispatch(tr);
                                return true;
                            } catch (e) {
                                console.error('Pagination underflow (page-level) error:', e);
                            }
                        }
                    }
                }
                
                // Body-Underflow (auch wenn kein page-level paragraph, IMMER prüfen)
                const domNextBody = domPages[nextIdx]?.querySelector('.letter-body');
                
                if (domNextBody && nextPage.bodyNode && nextPage.bodyNode.childCount > 0) {
                    const firstChildDom = domNextBody.firstElementChild;
                    if (firstChildDom) {
                        const childHeight = firstChildDom.getBoundingClientRect().height;
                        // Freien Platz berechnen: Abstand vom letzten Kind zum Body-Ende
                        const bodyRect2 = domBody.getBoundingClientRect();
                        const lastBodyChild2 = domBody.lastElementChild;
                        const contentBottom2 = lastBodyChild2 ? lastBodyChild2.getBoundingClientRect().bottom : bodyRect2.top;
                        const freeSpace = bodyRect2.top + domBody.clientHeight - contentBottom2;
                        
                        if (childHeight > 0 && childHeight <= freeSpace) {
                            try {
                                const firstChild = nextPage.bodyNode.firstChild;
                                const fcStart = nextPage.bodyPos + 1;
                                const fcEnd = fcStart + firstChild.nodeSize;
                                const tr = editor.state.tr;
                                tr.insert(page.bodyEnd - 1, firstChild.copy(firstChild.content));
                                tr.delete(tr.mapping.map(fcStart), tr.mapping.map(fcEnd));
                                editor.view.dispatch(tr);
                                return true;
                            } catch (e) {
                                console.error('Pagination underflow error:', e);
                            }
                        }
                    }
                } else if (!isPageLevelParagraph && nextPage.bodyNode && nextPage.bodyNode.childCount === 0) {
                    // Leere Seite entfernen (keine Seiten-Level-Absätze und leerer Body)
                    const hasPageLevelContent = (() => {
                        let found = false;
                        nextPage.node.forEach(child => {
                            if (!structuralTypes.includes(child.type.name)) found = true;
                        });
                        return found;
                    })();
                    if (!hasPageLevelContent) {
                        try {
                            editor.view.dispatch(editor.state.tr.delete(nextPage.pos, nextPage.end));
                            return true;
                        } catch (e) {
                            console.error('Error deleting empty page:', e);
                        }
                    }
                }
            }
        }
        
        return false;
    };
    
    // Führt die Pagination in einer Schleife aus bis keine Änderung mehr nötig ist
    const runFullPagination = (editor) => {
        if (!editor?.view?.dom) return;
        let changed = true;
        let iterations = 0;
        const MAX_ITERATIONS = 30; // Schutz gegen Endlosschleifen
        while (changed && iterations < MAX_ITERATIONS) {
            changed = runPaginationStep(editor);
            iterations++;
        }
        // Page-Count aktualisieren
        let count = 0;
        editor.state.doc.descendants(node => {
            if (node.type.name === 'letterPage') count++;
        });
        setPageCount(count > 0 ? count : 1);
    };

    // Scroll corresponding page into view
    const scrollToPage = (pageNumber) => {
        setPreviewPage(pageNumber);
        const domPages = document.querySelectorAll(showLivePreview ? '.preview-live-container > .letter-page' : '.ProseMirror > .letter-page');
        if (domPages && domPages[pageNumber - 1]) {
            domPages[pageNumber - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    // Pagination side-effect hooks
    useEffect(() => {
        if (!editor || loading) return;
        
        let timeoutId = null;
        let rafId = null;
        
        const handlePagination = () => {
            runFullPagination(editor);
        };
        
        const onUpdateOrSelection = () => {
            if (timeoutId) clearTimeout(timeoutId);
            // Debounce 50ms – Balance zwischen Reaktivität und Performance
            timeoutId = setTimeout(() => {
                requestAnimationFrame(handlePagination);
            }, 50);
        };
        
        editor.on('update', onUpdateOrSelection);
        editor.on('selectionUpdate', onUpdateOrSelection);
        
        // Initial pagination after content is loaded (DOM muss fertig sein)
        rafId = requestAnimationFrame(() => {
            timeoutId = setTimeout(handlePagination, 300);
        });
        
        return () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (rafId) cancelAnimationFrame(rafId);
            editor.off('update', onUpdateOrSelection);
            editor.off('selectionUpdate', onUpdateOrSelection);
        };
    }, [editor, loading, showLivePreview]);

    useEffect(() => {
        if (!editor || loading) return;
        
        const handleSelectionUpdate = () => {
            const pos = editor.state.selection.from;
            const doc = editor.state.doc;
            const pages = getPagesFromDoc(doc);
            
            for (let i = 0; i < pages.length; i++) {
                if (pos >= pages[i].pos && pos <= pages[i].end) {
                    setPreviewPage(i + 1);
                    break;
                }
            }
        };
        
        editor.on('selectionUpdate', handleSelectionUpdate);
        return () => {
            editor.off('selectionUpdate', handleSelectionUpdate);
        };
    }, [editor, loading]);

    useEffect(() => {
        setPreviewPage(1);
        setShowLivePreview(false);
        if (editor) {
            let count = 0;
            editor.state.doc.descendants(node => {
                if (node.type.name === 'letterPage') {
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
                if (node.type.name === 'letterPage') {
                    count++;
                }
            });
            setPageCount(count > 0 ? count : 1);
            setPreviewPage(1);
        }
    }, [loading, editor]);

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
            let query = supabase
                .from('document_templates')
                .select('*')
                .eq('is_custom', true);

            const portfolioIds = (portfolios || []).map(p => p.id);
            if (portfolioIds.length > 0) {
                query = query.or(`user_id.eq.${user.id},portfolio_id.in.(${portfolioIds.join(',')})`);
            } else {
                query = query.eq('user_id', user.id);
            }

            const { data, error } = await query;
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
                .eq('type', activeType);

            if (portfolioFilter) {
                query = query.eq('portfolio_id', portfolioFilter);
            } else {
                query = query.eq('user_id', user.id).is('portfolio_id', null);
            }


            const { data, error } = await query.maybeSingle();

            if (error) throw error;

            if (data) {
                setSubject(data.subject || '');
                editor?.commands.setContent(data.content_html || '');
                setDiagnostics({
                    lastError: null,
                    loadSource: 'Datenbank (Portfolio)',
                    dbDataFound: true,
                    contentLength: (data.content_html || '').length
                });
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
                            setDiagnostics({
                                lastError: null,
                                loadSource: 'Datenbank (Eigene Global)',
                                dbDataFound: true,
                                contentLength: (globalCustom.content_html || '').length
                            });
                            setLoading(false);
                            return;
                        }
                    }
                    editor?.commands.setContent('');
                    setSubject('');
                    setDiagnostics({
                        lastError: null,
                        loadSource: 'Datenbank (Eigene Leer)',
                        dbDataFound: false,
                        contentLength: 0
                    });
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
                        setDiagnostics({
                            lastError: null,
                            loadSource: 'Datenbank (Global)',
                            dbDataFound: true,
                            contentLength: (globalData.content_html || '').length
                        });
                        setLoading(false);
                        return;
                    }
                }
                
                // Fallback to hardcoded defaults
                const defaultVal = DEFAULT_TEMPLATES[activeType] || { subject: '', content_html: '' };
                setSubject(defaultVal.subject || '');
                editor?.commands.setContent(defaultVal.content_html || '');
                setDiagnostics({
                    lastError: null,
                    loadSource: 'Hardcoded Default',
                    dbDataFound: false,
                    contentLength: (defaultVal.content_html || '').length
                });
            }
        } catch (error) {
            console.error('Error loading template:', error);
            // Fallback to hardcoded defaults in case of DB or network error
            const defaultVal = DEFAULT_TEMPLATES[activeType] || { subject: '', content_html: '' };
            setSubject(defaultVal.subject || '');
            editor?.commands.setContent(defaultVal.content_html || '');
            setDiagnostics({
                lastError: error.message || String(error),
                loadSource: 'Fehler-Fallback (Default)',
                dbDataFound: false,
                contentLength: (defaultVal.content_html || '').length
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchCustomTemplates();
        }
    }, [user, portfolios]);


    useEffect(() => {
        if (editor) {
            setSelectedVariable(null);
            loadTemplate();
        }
    }, [activeType, selectedPortfolioId, editor, user, customTemplates]);

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
                .eq('type', activeType);

            if (portfolioFilter) {
                query = query.eq('portfolio_id', portfolioFilter);
            } else {
                query = query.eq('user_id', user.id).is('portfolio_id', null);
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

            let error;
            if (existingRecord) {
                const { error: updateError } = await supabase
                    .from('document_templates')
                    .update(payload)
                    .eq('id', existingRecord.id);
                error = updateError;
            } else {
                const { error: insertError } = await supabase
                    .from('document_templates')
                    .insert([payload]);
                error = insertError;
            }


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
                .eq('id', templateId);

            if (error) throw error;


            await fetchCustomTemplates();
            setActiveType('payment_reminder');
        } catch (error) {
            alert('Fehler beim Löschen: ' + error.message);
        }
    };

    // Insert variable chip into editor
    const insertVariable = (variable) => {
        setSelectedVariable(variable);
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

    // Get resolved content with mock data filled in
    const getResolvedHtml = (contentHtml) => {
        if (!contentHtml) return '';
        
        const mockData = {
            mieter_name: "Max Mustermann",
            mieter_anrede: "Sehr geehrter Herr Mustermann",
            mieter_adresse: "Musterweg 12<br/>12345 Musterstadt",
            objekt_name: "Wohnpark Sonnenseite",
            einheit_name: "Wohnung EG links",
            objekt_adresse: "Musterstraße 42, 12345 Musterstadt",
            vermieter_name: selectedPortfolioCompany || selectedPortfolioName || "ImmoControlpro Vermieter GmbH",
            vermieter_bankverbindung: selectedPortfolioBank && selectedPortfolioIban && selectedPortfolioBic
                ? `${selectedPortfolioBank}<br/>IBAN: ${selectedPortfolioIban}<br/>BIC: ${selectedPortfolioBic}`
                : "Sparkasse Musterstadt<br/>IBAN: DE89 5005 0400 1122 3344 55<br/>BIC: SOLODEM1MUC",
            offener_betrag: "908,70 €",
            zahlungsfrist_datum: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString('de-DE'),
            verzugstage: "14",
            mahnstufe: "2",
            zinsbetrag: "3,70 €",
            abrechnungsjahr: "2025",
            abrechnungszeitraum: "01.01.2025 - 31.12.2025",
            nutzungszeitraum: "01.01.2025 - 31.12.2025",
            gesamtkosten_mieter: "550,00 €",
            vorauszahlungs_betrag: "400,00 €",
            saldo_betrag: "150,00 €",
            saldo_art: "Nachzahlung",
            gast_name: "Dr. Sabine Sommer",
            gast_adresse: "Lindenallee 7<br/>50667 Köln",
            buchungszeitraum: "15.05.2026 - 22.05.2026",
            gaeste_anzahl: "2",
            rechnungsnummer: "RE-2026-0412",
            rechnungsdatum: new Date().toLocaleDateString('de-DE'),
            netto_betrag: "560,75 €",
            mwst_betrag: "39,25 €",
            brutto_betrag: "600,00 €",
            original_rechnungsnummer: "RE-2026-0399",
            aktuelle_miete: "650,00 €",
            neue_miete: "715,00 €",
            erhoehungs_betrag: "65,00 €",
            erhoehungs_datum: "01.08.2026",
            zustimmungs_frist: "31.07.2026",
            einzug_datum: "01.06.2026",
            vermieter_adresse: selectedPortfolioAddress || "Musterstraße 42, 12345 Musterstadt",
            vermieter_email: selectedPortfolioEmail,
            vermieter_telefon: selectedPortfolioPhone,
            vermieter_steuernummer: selectedPortfolioTax || "123/456/78901",
            vermieter_ust_id: selectedPortfolioVat || "DE123456789",
            rechnungs_datum: new Date().toLocaleDateString('de-DE'),
            erstellungsdatum: new Date().toLocaleDateString('de-DE'),
            mieter_nachname: "Mustermann",
            storno_nummer: "ST-2026-0001",
            kaution_betrag: "1.950,00 €"
        };

        if (location.state?.tenant) {
            const t = location.state.tenant;
            const fullName = `${t.first_name || ''} ${t.last_name || ''}`.trim();
            if (fullName) {
                mockData.mieter_name = fullName;
                mockData.mieter_nachname = t.last_name || mockData.mieter_nachname;
                const salute = t.gender === 'female' ? 'Sehr geehrte Frau' : t.gender === 'male' ? 'Sehr geehrter Herr' : 'Sehr geehrte(r) Frau/Herr';
                mockData.mieter_anrede = t.last_name ? `${salute} ${t.last_name}` : mockData.mieter_anrede;
            }
            if (t.street) {
                mockData.mieter_adresse = `${t.street} ${t.house_number || ''}<br/>${t.zip || ''} ${t.city || ''}`;
            }
            mockData.objekt_name = t.objekt_name || mockData.objekt_name;
            mockData.einheit_name = t.einheit_name || mockData.einheit_name;
            if (t.street) {
                mockData.objekt_adresse = `${t.street} ${t.house_number || ''}, ${t.zip || ''} ${t.city || ''}`.trim();
            }
            if (t.cold_rent) {
                const rentVal = parseFloat(t.cold_rent) || 0;
                mockData.aktuelle_miete = rentVal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
                const increaseVal = rentVal * 0.15;
                const newRentVal = rentVal + increaseVal;
                mockData.neue_miete = newRentVal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
                mockData.erhoehungs_betrag = increaseVal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
            }
        }

        const mockTables = {
            forderungs_tabelle: `
                <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 10pt;">
                  <thead>
                    <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; text-align: left;">
                      <th style="padding: 8px; border: 1px solid #cbd5e1;">Fälligkeit</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1;">Bezeichnung</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Soll-Betrag</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Ist-Betrag</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Offen</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">04.05.2026</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Grundmiete + NK-Vorauszahlung Mai 2026</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">850,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">0,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">850,00 €</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">04.05.2026</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Mahngebühr Stufe 1</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">5,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">0,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">5,00 €</td>
                    </tr>
                    <tr style="font-weight: bold; background-color: #f1f5f9;">
                      <td colspan="4" style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Gesamtrückstand:</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #dc2626;">855,00 €</td>
                    </tr>
                  </tbody>
                </table>`,
            
            forderungs_detail_tabelle: `
                <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 9pt;">
                  <thead>
                    <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; text-align: left;">
                      <th style="padding: 6px; border: 1px solid #cbd5e1;">Datum / Zeitraum</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1;">Posten</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Soll</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Haben</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Zinssatz</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Zinsen</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Offen</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">01.05.2026 - 31.05.2026</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Miete Mai 2026</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">850,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">0,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">5,12% p.a.</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">3,70 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">853,70 €</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">12.05.2026</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Mahngebühr Stufe 1</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">5,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">0,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">-</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; -"></td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">5,00 €</td>
                    </tr>
                    <tr style="font-weight: bold; background-color: #f1f5f9;">
                      <td colspan="6" style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Gesamtsumme inkl. Zinsen:</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; color: #dc2626;">858,70 €</td>
                    </tr>
                  </tbody>
                </table>`,
            
            nebenkosten_tabelle: `
                <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 10pt;">
                  <thead>
                    <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; text-align: left;">
                      <th style="padding: 8px; border: 1px solid #cbd5e1;">Kostenart</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1;">Gesamtkosten</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1;">Verteilerschlüssel</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Ihr Anteil</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Grundsteuer</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">1.200,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Miteigentumsanteil</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">150,00 €</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Müllabfuhr & Straßenreinigung</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">800,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Wohneinheiten</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">100,00 €</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Heizkosten (Schätzung)</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">2.400,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Wohnfläche (m²)</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">300,00 €</td>
                    </tr>
                    <tr style="font-weight: bold; background-color: #f1f5f9;">
                      <td colspan="3" style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Summe Umlagefähige Kosten:</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">550,00 €</td>
                    </tr>
                  </tbody>
                </table>`,
            
            nebenkosten_detail_tabelle: `
                <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 9pt;">
                  <thead>
                    <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; text-align: left;">
                      <th style="padding: 6px; border: 1px solid #cbd5e1;">Betriebskostenart</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Gesamtkosten</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1;">Verteilerschlüssel</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Ihr Anteil</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Abwasser</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">600,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Personenmonate</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">75,00 €</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Frischwasser</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">900,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Wassermesser (m³)</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">125,00 €</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Allgemeinstrom</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">350,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Miteigentumsanteil</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">45,00 €</td>
                    </tr>
                    <tr style="font-weight: bold; background-color: #f1f5f9;">
                      <td colspan="3" style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Summe Umlagefähige Kosten:</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">245,00 €</td>
                    </tr>
                  </tbody>
                </table>`,
            
            positions_tabelle: `
                <table class="invoice-table">
                  <thead>
                    <tr>
                      <th style="width: 5%; text-align: center;">Pos</th>
                      <th style="width: 55%;">Beschreibung</th>
                      <th style="width: 10%; text-align: right;">Menge</th>
                      <th style="width: 15%; text-align: right;">Einzel</th>
                      <th style="width: 15%; text-align: right;">MwSt</th>
                      <th style="width: 15%; text-align: right;">Gesamt</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style="text-align: center; padding: 8px 0; vertical-align: top;">1</td>
                      <td style="text-align: left; padding: 8px 10px; word-wrap: break-word; vertical-align: top;">Übernachtungskosten FEWO (7 Nächte)</td>
                      <td style="text-align: right; padding: 8px 0; white-space: nowrap; vertical-align: top;">1</td>
                      <td style="text-align: right; padding: 8px 0; white-space: nowrap; vertical-align: top;">420,56 €</td>
                      <td style="text-align: right; padding: 8px 0; vertical-align: top;">7%</td>
                      <td style="text-align: right; padding: 8px 0; font-weight: bold; white-space: nowrap; vertical-align: top;">450,00 €</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                      <td style="text-align: center; padding: 8px 0; vertical-align: top;">2</td>
                      <td style="text-align: left; padding: 8px 10px; word-wrap: break-word; vertical-align: top;">Endreinigung Pauschal</td>
                      <td style="text-align: right; padding: 8px 0; white-space: nowrap; vertical-align: top;"></td>
                      <td style="text-align: right; padding: 8px 0; white-space: nowrap; vertical-align: top;">74,77 €</td>
                      <td style="text-align: right; padding: 8px 0; vertical-align: top;">7%</td>
                      <td style="text-align: right; padding: 8px 0; font-weight: bold; white-space: nowrap; vertical-align: top;">80,00 €</td>
                    </tr>
                    <tr>
                      <td style="text-align: center; padding: 8px 0; vertical-align: top;">3</td>
                      <td style="text-align: left; padding: 8px 10px; word-wrap: break-word; vertical-align: top;">Kurbeitrag (Gästetax) Erwachsen</td>
                      <td style="text-align: right; padding: 8px 0; white-space: nowrap; vertical-align: top;"></td>
                      <td style="text-align: right; padding: 8px 0; white-space: nowrap; vertical-align: top;">65,42 €</td>
                      <td style="text-align: right; padding: 8px 0; vertical-align: top;">7%</td>
                      <td style="text-align: right; padding: 8px 0; font-weight: bold; white-space: nowrap; vertical-align: top;">70,00 €</td>
                    </tr>
                  </tbody>
                </table>
                <div class="totals" style="display: flex; justify-content: flex-end; margin-bottom: 20mm;">
                  <div class="totals-box" style="width: 80mm;">
                    <div class="t-row" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                      <span>Summe Netto</span>
                      <span>560,75 €</span>
                    </div>
                    <div class="t-row" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                      <span>zzgl. 7% MwSt</span>
                      <span>39,25 €</span>
                    </div>
                    <div class="t-row final" style="display: flex; justify-content: space-between; margin-bottom: 4px; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px; font-weight: 700; font-size: 11pt;">
                      <span>Gesamtbetrag</span>
                      <span>600,00 €</span>
                    </div>
                  </div>
                </div>`
        };

        let res = contentHtml;
        
        // 1. Tabellen-Platzhalter
        Object.keys(mockTables).forEach(key => {
            const mentionRegex = new RegExp(`<span[^>]*data-id=["']${key}["'][^>]*>.*?</span>`, 'gi');
            res = res.replace(mentionRegex, mockTables[key]);
            
            const textRegex = new RegExp(`\\{${key}\\}`, 'g');
            res = res.replace(textRegex, mockTables[key]);
        });

        // 2. Reguläre Platzhalter
        Object.keys(mockData).forEach(key => {
            const mentionRegex = new RegExp(`<span[^>]*data-id=["']${key}["'][^>]*>.*?</span>`, 'gi');
            res = res.replace(mentionRegex, mockData[key]);
            
            const textRegex = new RegExp(`\\{${key}\\}`, 'g');
            res = res.replace(textRegex, mockData[key]);
        });

        return res;
    };

    // Open A4 print preview window with replaced placeholders and tables
    const handlePrintPreview = () => {
        if (!editor) return;

        // 1. Editor-Inhalt holen
        let contentHtml = editor.getHTML();

        // 2. Realistische Testdaten definieren
        const mockData = {
            mieter_name: "Max Mustermann",
            mieter_anrede: "Sehr geehrter Herr Mustermann",
            mieter_adresse: "Musterweg 12<br/>12345 Musterstadt",
            objekt_name: "Wohnpark Sonnenseite",
            einheit_name: "Wohnung EG links",
            objekt_adresse: "Musterstraße 42, 12345 Musterstadt",
            vermieter_name: selectedPortfolioCompany || selectedPortfolioName || "ImmoControlpro Vermieter GmbH",
            vermieter_bankverbindung: selectedPortfolioBank && selectedPortfolioIban && selectedPortfolioBic
                ? `${selectedPortfolioBank}<br/>IBAN: ${selectedPortfolioIban}<br/>BIC: ${selectedPortfolioBic}`
                : "Sparkasse Musterstadt<br/>IBAN: DE89 5005 0400 1122 3344 55<br/>BIC: SOLODEM1MUC",
            offener_betrag: "908,70 €",
            zahlungsfrist_datum: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString('de-DE'),
            verzugstage: "14",
            mahnstufe: "2",
            zinsbetrag: "3,70 €",
            abrechnungsjahr: "2025",
            abrechnungszeitraum: "01.01.2025 - 31.12.2025",
            nutzungszeitraum: "01.01.2025 - 31.12.2025",
            gesamtkosten_mieter: "550,00 €",
            vorauszahlungs_betrag: "400,00 €",
            saldo_betrag: "150,00 €",
            saldo_art: "Nachzahlung",
            gast_name: "Dr. Sabine Sommer",
            gast_adresse: "Lindenallee 7<br/>50667 Köln",
            buchungszeitraum: "15.05.2026 - 22.05.2026",
            gaeste_anzahl: "2",
            rechnungsnummer: "RE-2026-0412",
            rechnungsdatum: new Date().toLocaleDateString('de-DE'),
            netto_betrag: "560,75 €",
            mwst_betrag: "39,25 €",
            brutto_betrag: "600,00 €",
            original_rechnungsnummer: "RE-2026-0399",
            aktuelle_miete: "650,00 €",
            neue_miete: "715,00 €",
            erhoehungs_betrag: "65,00 €",
            erhoehungs_datum: "01.08.2026",
            zustimmungs_frist: "31.07.2026",
            einzug_datum: "01.06.2026",
            vermieter_adresse: selectedPortfolioAddress || "Musterstraße 42, 12345 Musterstadt",
            vermieter_email: selectedPortfolioEmail,
            vermieter_telefon: selectedPortfolioPhone,
            vermieter_steuernummer: selectedPortfolioTax || "123/456/78901",
            vermieter_ust_id: selectedPortfolioVat || "DE123456789",
            rechnungs_datum: new Date().toLocaleDateString('de-DE'),
            erstellungsdatum: new Date().toLocaleDateString('de-DE'),
            mieter_nachname: "Mustermann",
            storno_nummer: "ST-2026-0001",
            kaution_betrag: "1.950,00 €"
        };

        if (location.state?.tenant) {
            const t = location.state.tenant;
            const fullName = `${t.first_name || ''} ${t.last_name || ''}`.trim();
            if (fullName) {
                mockData.mieter_name = fullName;
                mockData.mieter_nachname = t.last_name || mockData.mieter_nachname;
                const salute = t.gender === 'female' ? 'Sehr geehrte Frau' : t.gender === 'male' ? 'Sehr geehrter Herr' : 'Sehr geehrte(r) Frau/Herr';
                mockData.mieter_anrede = t.last_name ? `${salute} ${t.last_name}` : mockData.mieter_anrede;
            }
            if (t.street) {
                mockData.mieter_adresse = `${t.street} ${t.house_number || ''}<br/>${t.zip || ''} ${t.city || ''}`;
            }
            mockData.objekt_name = t.objekt_name || mockData.objekt_name;
            mockData.einheit_name = t.einheit_name || mockData.einheit_name;
            if (t.street) {
                mockData.objekt_adresse = `${t.street} ${t.house_number || ''}, ${t.zip || ''} ${t.city || ''}`.trim();
            }
            if (t.cold_rent) {
                const rentVal = parseFloat(t.cold_rent) || 0;
                mockData.aktuelle_miete = rentVal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
                const increaseVal = rentVal * 0.15;
                const newRentVal = rentVal + increaseVal;
                mockData.neue_miete = newRentVal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
                mockData.erhoehungs_betrag = increaseVal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
            }
        }

        // Realistische Tabellenvorlagen definieren
        const mockTables = {
            forderungs_tabelle: `
                <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 10pt;">
                  <thead>
                    <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; text-align: left;">
                      <th style="padding: 8px; border: 1px solid #cbd5e1;">Fälligkeit</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1;">Bezeichnung</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Soll-Betrag</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Ist-Betrag</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Offen</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">04.05.2026</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Grundmiete + NK-Vorauszahlung Mai 2026</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">850,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">0,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">850,00 €</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">04.05.2026</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Mahngebühr Stufe 1</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">5,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">0,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">5,00 €</td>
                    </tr>
                    <tr style="font-weight: bold; background-color: #f1f5f9;">
                      <td colspan="4" style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Gesamtrückstand:</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; color: #dc2626;">855,00 €</td>
                    </tr>
                  </tbody>
                </table>`,
            
            forderungs_detail_tabelle: `
                <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 9pt;">
                  <thead>
                    <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; text-align: left;">
                      <th style="padding: 6px; border: 1px solid #cbd5e1;">Datum / Zeitraum</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1;">Posten</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Soll</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Haben</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Zinssatz</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Zinsen</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Offen</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">01.05.2026 - 31.05.2026</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Miete Mai 2026</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">850,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">0,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">5,12% p.a.</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">3,70 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">853,70 €</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">12.05.2026</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Mahngebühr Stufe 1</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">5,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">0,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">-</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">-</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">5,00 €</td>
                    </tr>
                    <tr style="font-weight: bold; background-color: #f1f5f9;">
                      <td colspan="6" style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Gesamtsumme inkl. Zinsen:</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; color: #dc2626;">858,70 €</td>
                    </tr>
                  </tbody>
                </table>`,
            
            nebenkosten_tabelle: `
                <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 10pt;">
                  <thead>
                    <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; text-align: left;">
                      <th style="padding: 8px; border: 1px solid #cbd5e1;">Kostenart</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1;">Gesamtkosten</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1;">Verteilerschlüssel</th>
                      <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Ihr Anteil</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Grundsteuer</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">1.200,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Miteigentumsanteil</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">150,00 €</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Müllabfuhr & Straßenreinigung</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">800,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Wohneinheiten</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">100,00 €</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Heizkosten (Schätzung)</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">2.400,00 €</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1;">Wohnfläche (m²)</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">300,00 €</td>
                    </tr>
                    <tr style="font-weight: bold; background-color: #f1f5f9;">
                      <td colspan="3" style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Summe Umlagefähige Kosten:</td>
                      <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">550,00 €</td>
                    </tr>
                  </tbody>
                </table>`,
            
            nebenkosten_detail_tabelle: `
                <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 9pt;">
                  <thead>
                    <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; text-align: left;">
                      <th style="padding: 6px; border: 1px solid #cbd5e1;">Betriebskostenart</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Gesamtkosten</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1;">Umlageschlüssel</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Gesamteinheiten</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Ihre Einheiten</th>
                      <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Anteil €</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Grundsteuer</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">1.200,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Quadratmeter</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">400,00 m²</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">50,00 m²</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">150,00 €</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Wohngebäudeversicherung</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">800,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Miteigentumsanteil</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">1.000,00 MEA</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">125,00 MEA</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">100,00 €</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Kabelgebühren / TV</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">600,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Wohneinheiten</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">6 WE</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">1 WE</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">100,00 €</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Hausmeister & Gartenpflege</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">1.600,00 €</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1;">Quadratmeter</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">400,00 m²</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">50,00 m²</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">200,00 €</td>
                    </tr>
                    <tr style="font-weight: bold; background-color: #f1f5f9;">
                      <td colspan="5" style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Gesamtsumme Umlage:</td>
                      <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; color: #1e3a8a;">550,00 €</td>
                    </tr>
                  </tbody>
                </table>`,
            
            positions_tabelle: `
                <table class="invoice-table" style="width: 100%; border-collapse: collapse; margin-bottom: 8mm;">
                  <thead>
                    <tr>
                      <th style="width: 8%; text-align: center; border-bottom: 2px solid #000; padding: 8px 0; font-weight: 700;">Pos.</th>
                      <th style="width: 42%; text-align: left; border-bottom: 2px solid #000; padding: 8px 10px; font-weight: 700;">Bezeichnung</th>
                      <th style="width: 15%; text-align: right; border-bottom: 2px solid #000; padding: 8px 0; font-weight: 700;">Einzelpreis</th>
                      <th style="width: 15%; text-align: right; border-bottom: 2px solid #000; padding: 8px 0; font-weight: 700;">Netto</th>
                      <th style="width: 5%; text-align: right; border-bottom: 2px solid #000; padding: 8px 0; font-weight: 700;">MwSt</th>
                      <th style="width: 15%; text-align: right; border-bottom: 2px solid #000; padding: 8px 0; font-weight: 700;">Brutto</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style="border-bottom: 1px solid #ddd;">
                      <td style="text-align: center; padding: 6px 0; vertical-align: top;">1</td>
                      <td style="text-align: left; padding: 6px 10px; word-wrap: break-word; vertical-align: top;">3 Übernachtungen in Ferienwohnung "Bergblick"<br/><small style="color: #64748b;">Zeitraum: 15.05.2026 - 18.05.2026</small></td>
                      <td style="text-align: right; padding: 6px 0; white-space: nowrap; vertical-align: top;">150,00 €</td>
                      <td style="text-align: right; padding: 6px 0; white-space: nowrap; vertical-align: top;">420,56 €</td>
                      <td style="text-align: right; padding: 6px 0; vertical-align: top;">7%</td>
                      <td style="text-align: right; padding: 6px 0; font-weight: bold; white-space: nowrap; vertical-align: top;">450,00 €</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #ddd;">
                      <td style="text-align: center; padding: 6px 0; vertical-align: top;">2</td>
                      <td style="text-align: left; padding: 6px 10px; word-wrap: break-word; vertical-align: top;">Endreinigung Pauschal</td>
                      <td style="text-align: right; padding: 6px 0; white-space: nowrap; vertical-align: top;"></td>
                      <td style="text-align: right; padding: 6px 0; white-space: nowrap; vertical-align: top;">74,77 €</td>
                      <td style="text-align: right; padding: 6px 0; vertical-align: top;">7%</td>
                      <td style="text-align: right; padding: 6px 0; font-weight: bold; white-space: nowrap; vertical-align: top;">80,00 €</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #ddd;">
                      <td style="text-align: center; padding: 6px 0; vertical-align: top;">3</td>
                      <td style="text-align: left; padding: 6px 10px; word-wrap: break-word; vertical-align: top;">Kurbeitrag (Gästetax) Erwachsen</td>
                      <td style="text-align: right; padding: 6px 0; white-space: nowrap; vertical-align: top;"></td>
                      <td style="text-align: right; padding: 6px 0; white-space: nowrap; vertical-align: top;">65,42 €</td>
                      <td style="text-align: right; padding: 6px 0; vertical-align: top;">7%</td>
                      <td style="text-align: right; padding: 6px 0; font-weight: bold; white-space: nowrap; vertical-align: top;">70,00 €</td>
                    </tr>
                  </tbody>
                </table>
                <div class="totals" style="display: flex; justify-content: flex-end; margin-bottom: 20mm;">
                  <div class="totals-box" style="width: 80mm;">
                    <div class="t-row" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                      <span>Summe Netto</span>
                      <span>560,75 €</span>
                    </div>
                    <div class="t-row" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                      <span>zzgl. 7% MwSt</span>
                      <span>39,25 €</span>
                    </div>
                    <div class="t-row final" style="display: flex; justify-content: space-between; margin-bottom: 4px; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px; font-weight: 700; font-size: 11pt;">
                      <span>Gesamtbetrag</span>
                      <span>600,00 €</span>
                    </div>
                  </div>
                </div>`
        };

        // Ersetzungsmethode für Mentions & Text-Platzhalter
        const replacePlaceholders = (htmlStr) => {
            return getResolvedHtml(htmlStr);
        };

        const previewHtml = replacePlaceholders(contentHtml);

        // Neues Fenster öffnen und das PDF-Layout reinschreiben
        const win = window.open('', '_blank');
        if (win) {
            win.document.write(`<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>PDF Vorschau - ${activeConfig.label || activeConfig.name || 'Dokument'}</title>
    <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        @page {
            size: A4;
            margin: 0;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Open Sans', 'Arial', 'Helvetica', sans-serif;
            color: #000000;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        @media print {
            .no-print { display: none !important; }
            html, body {
                width: 210mm;
                height: 297mm;
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden;
                background: #ffffff;
            }
            .letter-page {
                box-shadow: none !important;
                border: none !important;
                margin: 0 !important;
                padding: 20mm 20mm 35mm 25mm !important;
                width: 210mm !important;
                height: 297mm !important;
                overflow: hidden !important;
                page-break-after: always !important;
                page-break-inside: avoid !important;
            }
            .letter-page:last-child {
                page-break-after: avoid !important;
            }
        }
        @media screen {
            body { 
                padding: 30px 20px; 
                background: #f1f5f9;
            }
            .letter-page {
                margin: 0 auto 30px;
                border-radius: 4px;
            }
        }
        
        /* DIN 5008 A4 Page Style */
        .letter-page {
            width: 210mm;
            height: 297mm;
            min-height: 297mm;
            max-height: 297mm;
            padding: 20mm 20mm 35mm 25mm;
            background: #ffffff !important;
            color: #000000 !important;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
            border: 1px solid #cbd5e1;
            font-size: 11pt;
            line-height: 1.5;
            position: relative;
            display: flex;
            flex-direction: column;
            text-align: left;
            overflow: hidden;
            box-sizing: border-box;
        }
        
        .letter-page > p {
            min-height: 1.2em;
            margin-bottom: 1em;
        }
        /* Leerzeilen: gleiche Höhe wie gefüllte Absätze */
        .letter-page p:empty,
        .letter-page p:has(> br:only-child),
        .letter-body p:empty,
        .letter-body p:has(> br:only-child) {
            min-height: 1.6em;
            margin-bottom: 1em !important;
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

        .letter-sender:has(+ hr),
        .letter-sender:has(+ .editor-hr) {
            border-bottom: none !important;
            padding-bottom: 0 !important;
            margin-bottom: 3mm !important;
        }

        .editor-hr,
        .letter-page hr {
            border: none;
            border-top: 1px solid #cccccc;
            margin: 2mm 0 5mm 0;
            width: 100%;
            display: block;
            height: 0;
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
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
            flex-grow: 1;
            flex-shrink: 1;
            min-height: 0;
            overflow: hidden;
            margin-bottom: 12mm;
            font-size: 11pt;
            line-height: 1.6;
            text-align: left;
        }
        
        .letter-body p {
            margin-bottom: 1em !important;
            min-height: 1.6em;
        }
        
        .letter-footer {
            position: absolute !important;
            bottom: 10mm !important;
            left: 25mm !important;
            right: 20mm !important;
            height: 18mm !important;
            margin-top: 0 !important;
            display: flex !important;
            justify-content: space-between !important;
            border-top: 1px solid #dddddd !important;
            padding-top: 3mm !important;
            font-size: 8pt !important;
            color: #666666 !important;
            line-height: 1.4 !important;
            text-align: left !important;
            box-sizing: border-box !important;
            background-color: #ffffff !important;
        }
        
        .footer-col {
            width: 30%;
        }
        
        /* Tabellen im Editor */
        table:not(.invoice-table) {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
            background-color: transparent !important;
            border: 1px solid #cbd5e1 !important;
        }
        table:not(.invoice-table) th {
            background-color: #f1f5f9 !important;
            color: #0f172a !important;
            font-weight: bold;
            border: 1px solid #cbd5e1 !important;
            padding: 8px 12px !important;
        }
        table:not(.invoice-table) td {
            border: 1px solid #cbd5e1 !important;
            padding: 8px 12px !important;
            color: #334155 !important;
            background-color: transparent !important;
        }
        
        /* Stile für Fewo-Rechnungen */
        .invoice-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 8mm;
            background-color: transparent !important;
            border: none !important;
        }
        .invoice-table th {
            border-bottom: 2px solid #000 !important;
            border-top: none !important;
            border-left: none !important;
            border-right: none !important;
            text-align: left;
            padding: 8px 0 !important;
            font-weight: 700;
            background-color: transparent !important;
            color: #000000 !important;
        }
        .invoice-table td {
            border-bottom: 1px solid #ddd !important;
            border-top: none !important;
            border-left: none !important;
            border-right: none !important;
            padding: 8px 0 !important;
            color: #000000 !important;
            background-color: transparent !important;
        }
        .totals {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 20mm;
        }
        .totals-box {
            width: 80mm;
        }
        .t-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
            color: #000000;
        }
        .t-row.final {
            border-top: 2px solid #000;
            padding-top: 4px;
            margin-top: 4px;
            font-weight: 700;
            font-size: 11pt;
            color: #000000;
        }
    </style>
</head>
<body>
    <!-- Print button (screen only) -->
    <div class="no-print" style="text-align:center;padding:12px 0 20px;">
        <button onclick="window.print()" style="padding:10px 28px;font-size:14px;font-weight:600;background:#0ea5e9;color:white;border:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);">
            🖨️ Als PDF drucken / speichern
        </button>
        <p style="margin-top:8px;font-size:12px;color:#64748b;">Drücke Strg+P oder klicke den Button. Wähle "Als PDF speichern" im Druckdialog.</p>
    </div>

    <div class="preview-content">
        ${previewHtml}
    </div>

    <script>
        // Automatisch den Druckdialog öffnen
        setTimeout(() => {
            window.print();
        }, 500);
    </script>
</body>
</html>`);
            win.document.close();
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
    const activePage = Math.min(previewPage, pageCount);

    return (
        <Card title="Schreibvorlagen verwalten" subtitle="Passe hier die automatischen Anschreiben, Mahnstufen, Verträge und Rechnungs-Texte nach deinen Vorstellungen an oder erstelle freie Briefe.">
            <style>{`
                .templates-layout-grid {
                    display: grid;
                    grid-template-columns: 280px 1fr;
                    gap: 2rem;
                    align-items: start;
                }
                @media (max-width: 768px) {
                    .templates-layout-grid {
                        grid-template-columns: 1fr;
                        gap: 1.5rem;
                    }
                }
                .editor-canvas-container {
                    padding: 2.5rem;
                    background-color: var(--background-color);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 1.5rem;
                    border-radius: var(--radius-md);
                    border: 1px solid var(--border-color-soft);
                    overflow-y: auto;
                    max-height: 800px;
                    width: 100%;
                    box-sizing: border-box;
                }
                .ProseMirror {
                    outline: none;
                    width: 100%;
                }
                /* A4 Seite im Editor – feste Höhe ist KRITISCH für Overflow-Erkennung */
                .ProseMirror > .letter-page,
                .preview-live-container > .letter-page {
                    display: flex !important;
                    flex-direction: column !important;
                    margin: 0 auto 20px auto !important;
                    width: 210mm !important;
                    height: 297mm !important;
                    min-height: 297mm !important;
                    max-height: 297mm !important;
                    padding: 20mm 20mm 35mm 25mm !important;
                    background: #ffffff !important;
                    border: 1px solid var(--border-color, #cbd5e1) !important;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.08) !important;
                    overflow: hidden !important;
                    position: relative !important;
                    box-sizing: border-box !important;
                    font-size: 11pt !important;
                    line-height: 1.5 !important;
                }
                /* Body: Flexibler Bereich zwischen Header und Footer */
                .ProseMirror .letter-body,
                .preview-live-container .letter-body {
                    flex: 1 1 auto !important;
                    min-height: 0 !important;
                    overflow: hidden !important;
                    margin-bottom: 12mm !important;
                    font-size: 11pt !important;
                    line-height: 1.6 !important;
                }
                /* Footer: Am Seitenende fixiert, NICHT editierbar im Editor */
                .ProseMirror .letter-footer,
                .preview-live-container .letter-footer {
                    position: absolute !important;
                    bottom: 10mm !important;
                    left: 25mm !important;
                    right: 20mm !important;
                    height: 18mm !important;
                    margin-top: 0 !important;
                    display: flex !important;
                    justify-content: space-between !important;
                    border-top: 1px solid #ddd !important;
                    padding-top: 3mm !important;
                    font-size: 8pt !important;
                    color: #666 !important;
                    box-sizing: border-box !important;
                    background-color: #ffffff !important;
                    user-select: none !important;
                    cursor: default !important;
                    opacity: 0.7 !important;
                }
                .ProseMirror .footer-col,
                .preview-live-container .footer-col {
                    width: 30%;
                }
                @media (max-width: 1450px) {
                    .letter-page {
                        zoom: 0.85;
                    }
                }
                @media (max-width: 1300px) {
                    .letter-page {
                        zoom: 0.75;
                    }
                }
                @media (max-width: 1100px) {
                    .letter-page {
                        zoom: 0.65;
                    }
                }
            `}</style>
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

            <div className="templates-layout-grid">
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

                    {/* Manage Layout Sections */}
                    {editor && !showLivePreview && (
                        <div style={{ 
                            display: 'flex', 
                            flexDirection: 'column', 
                            gap: '0.75rem', 
                            border: '1px solid var(--border-color)', 
                            borderRadius: 'var(--radius-md)', 
                            padding: '12px', 
                            backgroundColor: 'var(--background-color)'
                        }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Layers size={14} style={{ color: '#0ea5e9' }} />
                                    Brief-Bereiche
                                </h4>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Bereiche ein- oder ausblenden:</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {[
                                    ['letter-sender', 'Absenderzeile'],
                                    ['letter-header-row', 'Empfänger & Datum'],
                                    ['letter-subject', 'Betreffzeile'],
                                    ['letter-object', 'Objekt / Details'],
                                    ['letter-body', 'Brieftext / Inhalt'],
                                    ['letter-footer', 'Fußzeile']
                                ].map(([secClass, label]) => {
                                    const isPresent = getPresentSections()[secClass];
                                    return (
                                        <div key={secClass} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: 'var(--surface-color)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: isPresent ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                                {label}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (isPresent) {
                                                        let nodePos = -1;
                                                        editor.state.doc.descendants((node, pos) => {
                                                            if (node.type.name === classToNodeType[secClass]) {
                                                                nodePos = pos;
                                                                return false;
                                                            }
                                                        });
                                                        if (nodePos !== -1) deleteLayoutNode(nodePos);
                                                    } else {
                                                        addSection(secClass);
                                                    }
                                                }}
                                                style={{
                                                    border: 'none',
                                                    background: isPresent ? '#fee2e2' : '#e0f2fe',
                                                    color: isPresent ? '#ef4444' : '#0ea5e9',
                                                    padding: '3px 6px',
                                                    borderRadius: '4px',
                                                    fontSize: '0.7rem',
                                                    fontWeight: 600,
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                {isPresent ? 'Ausblenden' : 'Einblenden'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Variable Library */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', backgroundColor: 'var(--background-color)', flex: 1 }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0' }}>Platzhalter</h4>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Ziehe den Platzhalter in das Dokument oder füge ihn per Klick hinzu.</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', maxHeight: '230px', paddingRight: '4px' }}>
                            {activeConfig.variables?.map(v => (
                                <button
                                    key={v.id}
                                    onClick={() => setSelectedVariable(v)}
                                    draggable="true"
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'mention', id: v.id, label: v.label }));
                                    }}
                                    title={`Ziehe, um ${v.label} einzufügen. Klicke für Details.`}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '6px 8px',
                                        borderRadius: '6px',
                                        border: '1px solid',
                                        borderColor: selectedVariable?.id === v.id ? 'var(--primary-color)' : 'var(--border-color)',
                                        backgroundColor: selectedVariable?.id === v.id ? '#f0f9ff' : 'var(--surface-color)',
                                        cursor: 'grab',
                                        fontSize: '0.75rem',
                                        fontWeight: 500,
                                        color: 'var(--text-primary)',
                                        textAlign: 'left',
                                        transition: 'all 0.15s ease'
                                    }}
                                >
                                    <span>{v.icon}</span>
                                    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.label}</span>
                                    <span 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            insertVariable(v);
                                        }}
                                        title="In Dokument einfügen"
                                        style={{
                                            cursor: 'pointer',
                                            padding: '2px',
                                            borderRadius: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                            color: 'var(--primary-color)'
                                        }}
                                        onMouseEnter={e => {
                                            e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                                            e.currentTarget.style.color = '#ffffff';
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
                                            e.currentTarget.style.color = 'var(--primary-color)';
                                        }}
                                    >
                                        <Plus size={12} />
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* Dynamic Info explanation card */}
                        {selectedVariable ? (
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
                                    <span>{selectedVariable.icon}</span>
                                    <span>{selectedVariable.label}</span>
                                </div>
                                <p style={{ margin: 0 }}>
                                    {selectedVariable.description || 'Keine Beschreibung verfügbar.'}
                                </p>
                                {selectedVariable.id === 'mieter_anrede' && (
                                    <ul style={{ margin: '4px 0 0 0', paddingLeft: '14px', listStyleType: 'disc', color: '#1e3a8a' }}>
                                        <li>Frau: <em>„Sehr geehrte Frau [Nachname]“</em></li>
                                        <li>Herr: <em>„Sehr geehrter Herr [Nachname]“</em></li>
                                        <li>Mehrere/Sonstige: <em>„Sehr geehrte Damen und Herren“</em></li>
                                    </ul>
                                )}
                                <div style={{ fontSize: '0.7rem', color: '#4b5563', marginTop: '4px', fontFamily: 'monospace', backgroundColor: '#e2e8f0', padding: '2px 6px', borderRadius: '4px', alignSelf: 'flex-start' }}>
                                    {`{${selectedVariable.id}}`}
                                </div>
                                <button
                                    onClick={() => insertVariable(selectedVariable)}
                                    style={{
                                        marginTop: '6px',
                                        padding: '5px 8px',
                                        borderRadius: '4px',
                                        border: 'none',
                                        backgroundColor: 'var(--primary-color)',
                                        color: '#ffffff',
                                        cursor: 'pointer',
                                        fontSize: '0.7rem',
                                        fontWeight: 500,
                                        textAlign: 'center',
                                        width: '100%',
                                        transition: 'opacity 0.15s ease'
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.opacity = '0.9';
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.opacity = '1';
                                    }}
                                >
                                    In Dokument einfügen
                                </button>
                            </div>
                        ) : (
                            <div style={{ 
                                marginTop: '12px', 
                                padding: '10px', 
                                borderRadius: '6px', 
                                backgroundColor: 'var(--background-color)', 
                                border: '1px dashed var(--border-color)',
                                fontSize: '0.74rem',
                                color: 'var(--text-secondary)',
                                textAlign: 'center'
                            }}>
                                Klicke auf einen Platzhalter, um die Erklärung anzuzeigen.
                            </div>
                        )}
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

                                    {/* Trennlinie einfügen */}
                                    <button 
                                        type="button"
                                        onClick={() => editor?.chain().focus().setHorizontalRule().run()} 
                                        disabled={!editor}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                                        title="Trennlinie einfügen"
                                    >
                                        <Minus size={16} />
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
                                        <Button 
                                            variant={showLayoutOutlines ? "primary" : "secondary"} 
                                            size="sm" 
                                            icon={showLayoutOutlines ? Eye : EyeOff} 
                                            onClick={() => setShowLayoutOutlines(!showLayoutOutlines)}
                                            style={{ marginRight: '4px' }}
                                            title="Ausrichtungslinien und Beschriftungen im Editor anzeigen/ausblenden"
                                        >
                                            {showLayoutOutlines ? "Hilfslinien aus" : "Hilfslinien ein"}
                                        </Button>
                                        <Button 
                                            variant={showLivePreview ? "primary" : "secondary"} 
                                            size="sm" 
                                            icon={showLivePreview ? EyeOff : Eye} 
                                            onClick={() => setShowLivePreview(!showLivePreview)}
                                            style={{ marginRight: '4px' }}
                                        >
                                            {showLivePreview ? "Entwurf" : "Live-Vorschau"}
                                        </Button>
                                        <Button variant="secondary" size="sm" icon={FileText} onClick={handlePrintPreview}>
                                            PDF-Vorschau
                                        </Button>
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

                                {selectedNodeType === 'horizontalRule' && (
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        padding: '8px 16px',
                                        backgroundColor: 'var(--surface-color)',
                                        borderBottom: '1px solid var(--border-color)',
                                        fontSize: '0.85rem',
                                        color: 'var(--text-primary)',
                                        flexWrap: 'wrap'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--primary-color)' }}>
                                            <Sliders size={14} />
                                            <span>Linie anpassen:</span>
                                        </div>
                                        
                                        {/* Stil */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Stil:</span>
                                            <select
                                                value={getHrStyleValue('border-top-style') || 'solid'}
                                                onChange={(e) => updateHrStyle('border-top-style', e.target.value)}
                                                style={{ 
                                                    padding: '2px 6px', 
                                                    fontSize: '0.78rem', 
                                                    borderRadius: '4px', 
                                                    border: '1px solid var(--border-color)', 
                                                    backgroundColor: 'var(--background-color)',
                                                    color: 'var(--text-primary)'
                                                }}
                                            >
                                                <option value="solid">Durchgehend (solid)</option>
                                                <option value="dashed">Gestrichelt (dashed)</option>
                                                <option value="dotted">Gepunktet (dotted)</option>
                                                <option value="double">Doppelt (double)</option>
                                            </select>
                                        </div>

                                        {/* Stärke */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Stärke:</span>
                                            <select
                                                value={getHrStyleValue('border-top-width') || '1px'}
                                                onChange={(e) => updateHrStyle('border-top-width', e.target.value)}
                                                style={{ 
                                                    padding: '2px 6px', 
                                                    fontSize: '0.78rem', 
                                                    borderRadius: '4px', 
                                                    border: '1px solid var(--border-color)', 
                                                    backgroundColor: 'var(--background-color)',
                                                    color: 'var(--text-primary)'
                                                }}
                                            >
                                                <option value="1px">1 px</option>
                                                <option value="2px">2 px</option>
                                                <option value="3px">3 px</option>
                                                <option value="4px">4 px</option>
                                                <option value="5px">5 px</option>
                                            </select>
                                        </div>

                                        {/* Farbe */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Farbe:</span>
                                            <select
                                                value={getHrStyleValue('border-top-color') || '#cccccc'}
                                                onChange={(e) => updateHrStyle('border-top-color', e.target.value)}
                                                style={{ 
                                                    padding: '2px 6px', 
                                                    fontSize: '0.78rem', 
                                                    borderRadius: '4px', 
                                                    border: '1px solid var(--border-color)', 
                                                    backgroundColor: 'var(--background-color)',
                                                    color: 'var(--text-primary)'
                                                }}
                                            >
                                                <option value="#cccccc">Grau (Standard)</option>
                                                <option value="#000000">Schwarz</option>
                                                <option value="#1d4ed8">Blau</option>
                                                <option value="#dc2626">Rot</option>
                                                <option value="#10b981">Grün</option>
                                                <option value="#f59e0b">Orange</option>
                                            </select>
                                        </div>

                                        {/* Abstand oben */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Abstand oben:</span>
                                            <select
                                                value={getHrStyleValue('margin-top') || '2mm'}
                                                onChange={(e) => updateHrStyle('margin-top', e.target.value)}
                                                style={{ 
                                                    padding: '2px 6px', 
                                                    fontSize: '0.78rem', 
                                                    borderRadius: '4px', 
                                                    border: '1px solid var(--border-color)', 
                                                    backgroundColor: 'var(--background-color)',
                                                    color: 'var(--text-primary)'
                                                }}
                                            >
                                                <option value="0mm">0 mm</option>
                                                <option value="2mm">2 mm</option>
                                                <option value="5mm">5 mm</option>
                                                <option value="10mm">10 mm</option>
                                                <option value="15mm">15 mm</option>
                                                <option value="20mm">20 mm</option>
                                            </select>
                                        </div>

                                        {/* Abstand unten */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Abstand unten:</span>
                                            <select
                                                value={getHrStyleValue('margin-bottom') || '5mm'}
                                                onChange={(e) => updateHrStyle('margin-bottom', e.target.value)}
                                                style={{ 
                                                    padding: '2px 6px', 
                                                    fontSize: '0.78rem', 
                                                    borderRadius: '4px', 
                                                    border: '1px solid var(--border-color)', 
                                                    backgroundColor: 'var(--background-color)',
                                                    color: 'var(--text-primary)'
                                                }}
                                            >
                                                <option value="0mm">0 mm</option>
                                                <option value="2mm">2 mm</option>
                                                <option value="5mm">5 mm</option>
                                                <option value="10mm">10 mm</option>
                                                <option value="15mm">15 mm</option>
                                                <option value="20mm">20 mm</option>
                                            </select>
                                        </div>

                                        {/* Löschen */}
                                        <button
                                            type="button"
                                            onClick={() => editor.chain().focus().deleteSelection().run()}
                                            style={{
                                                marginLeft: 'auto',
                                                padding: '4px 8px',
                                                borderRadius: '4px',
                                                border: 'none',
                                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                color: 'var(--danger-color)',
                                                fontWeight: 600,
                                                fontSize: '0.75rem',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}
                                        >
                                            <Trash2 size={12} />
                                            <span>Linie löschen</span>
                                        </button>
                                    </div>
                                )}

                                {/* Editor Content Area (Word-like white sheet with DIN 5008 formatting) */}
                                 <div className="editor-canvas-container">
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
                                                 onClick={() => scrollToPage(Math.max(1, activePage - 1))}
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
                                                 onClick={() => scrollToPage(Math.min(pageCount, activePage + 1))}
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
                                     {showLivePreview ? (
                                         <div className="preview-live-container" dangerouslySetInnerHTML={{ __html: getResolvedHtml(editor ? editor.getHTML() : '') }} />
                                     ) : (
                                         <EditorContent editor={editor} />
                                     )}
                                    {layoutPopover && showLayoutOutlines && !showLivePreview && (
                                        <div className="layout-popover" style={{
                                            position: 'fixed',
                                            top: layoutPopover.popupTop,
                                            left: layoutPopover.popupLeft,
                                            zIndex: 9999, background: '#ffffff',
                                            border: '1px solid #e2e8f0', borderRadius: '10px',
                                            padding: '14px 16px',
                                            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                                            width: '210px', fontSize: '12px',
                                            fontFamily: 'Inter, system-ui, sans-serif'
                                        }}>
                                            <div style={{ fontWeight: 700, marginBottom: '10px', color: '#0ea5e9', fontSize: '13px', borderBottom: '2px solid #e2e8f0', paddingBottom: '6px' }}>
                                                {layoutPopover.label}
                                            </div>
                                            {[[ 'margin-top', 'marginTop', 'Abstand oben' ], [ 'margin-bottom', 'marginBottom', 'Abstand unten' ], [ 'height', 'height', 'Höhe' ], [ 'width', 'width', 'Breite' ]].map(([cssProp, key, lbl]) => (
                                                <label key={cssProp} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
                                                    <span style={{ color: '#475569' }}>{lbl}</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <input type="number" min="0" max="250" step="1"
                                                            value={layoutPopover.styles[key]}
                                                            onChange={(e) => updateLayoutStyle(cssProp, parseFloat(e.target.value) || 0)}
                                                            style={{ width: '48px', padding: '3px 6px', border: '1px solid #cbd5e1', borderRadius: '5px', textAlign: 'right', fontSize: '12px' }}
                                                        />
                                                        <span style={{ color: '#94a3b8', fontSize: '10px', minWidth: '20px' }}>mm</span>
                                                    </div>
                                                </label>
                                            ))}
                                            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                                                <button onClick={() => { 
                                                    updateLayoutStyle('margin-top', 0); 
                                                    setTimeout(() => updateLayoutStyle('margin-bottom', 0), 10); 
                                                    setTimeout(() => updateLayoutStyle('height', 0), 20); 
                                                    setTimeout(() => updateLayoutStyle('width', 0), 30); 
                                                }}
                                                    style={{ flex: 1, padding: '5px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', color: '#64748b' }}
                                                >Zurücksetzen</button>
                                            </div>

                                            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => moveLayoutNode(layoutPopover.nodePos, -1)}
                                                    disabled={!canMoveNode(layoutPopover.nodePos, -1)}
                                                    style={{
                                                        flex: 1, padding: '5px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: canMoveNode(layoutPopover.nodePos, -1) ? 'pointer' : 'not-allowed', fontSize: '11px', fontWeight: 600, color: '#475569', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px',
                                                        opacity: canMoveNode(layoutPopover.nodePos, -1) ? 1 : 0.4
                                                    }}
                                                    title="Nach oben verschieben"
                                                >
                                                    <ArrowUp size={12} /> Nach oben
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => moveLayoutNode(layoutPopover.nodePos, 1)}
                                                    disabled={!canMoveNode(layoutPopover.nodePos, 1)}
                                                    style={{
                                                        flex: 1, padding: '5px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: canMoveNode(layoutPopover.nodePos, 1) ? 'pointer' : 'not-allowed', fontSize: '11px', fontWeight: 600, color: '#475569', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px',
                                                        opacity: canMoveNode(layoutPopover.nodePos, 1) ? 1 : 0.4
                                                    }}
                                                    title="Nach unten verschieben"
                                                >
                                                    <ArrowDown size={12} /> Nach unten
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => deleteLayoutNode(layoutPopover.nodePos)}
                                                style={{
                                                    width: '100%', padding: '5px', marginTop: '6px', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 600, color: '#ef4444', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px'
                                                }}
                                                title="Diesen Bereich ausblenden"
                                            >
                                                <Trash2 size={12} /> Bereich ausblenden
                                            </button>
                                        </div>
                                    )}
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

            {/* Diagnose-Tools */}
            <div style={{
                marginTop: '2rem',
                padding: '1rem',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '8px',
                fontSize: '0.85rem',
                color: 'var(--text-primary)'
            }}>
                <details>
                    <summary style={{ fontWeight: 600, cursor: 'pointer', outline: 'none' }}>
                        🛠️ Editor-Diagnose (Hier klicken bei Fehlern)
                    </summary>
                    <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div><strong>User Status:</strong> {user ? `Eingeloggt (ID: ${user.id})` : 'Nicht eingeloggt'}</div>
                        <div><strong>Editor Status:</strong> {editor ? 'Initialisiert und geladen' : 'Nicht initialisiert'}</div>
                        <div><strong>Lade-Status:</strong> {loading ? 'Lädt...' : 'Bereit'}</div>
                        <div><strong>Aktive Vorlage (ID):</strong> {activeType}</div>
                        <div><strong>Aktives Portfolio (ID):</strong> {selectedPortfolioId}</div>
                        <div><strong>Datenquelle:</strong> {diagnostics.loadSource}</div>
                        <div><strong>Eintrag in DB gefunden:</strong> {diagnostics.dbDataFound ? 'Ja' : 'Nein'}</div>
                        <div><strong>Geladene HTML-Länge:</strong> {diagnostics.contentLength} Zeichen</div>
                        {diagnostics.lastError && (
                            <div style={{ color: 'var(--danger-color)', padding: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '4px', borderLeft: '3px solid var(--danger-color)' }}>
                                <strong>Letzter Fehler:</strong> {diagnostics.lastError}
                            </div>
                        )}
                        <div style={{ marginTop: '8px' }}>
                            <Button size="xs" variant="secondary" onClick={() => loadTemplate()}>
                                Vorlage neu laden
                            </Button>
                        </div>
                    </div>
                </details>
            </div>
        </Card>
    );
};

export default DocumentTemplates;
