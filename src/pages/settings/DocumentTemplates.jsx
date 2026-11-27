import React, { useState, useEffect, useMemo, useRef } from 'react';
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
// ProseMirror-Parser bewusst umbenannt: der Name "DOMParser" verdeckte sonst den
// Browser-DOMParser (new DOMParser() warf dadurch immer und die Platzhalter wurden nie ersetzt).
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import { openSansFontFaceCss, fontOrigin } from '../../lib/fontFaces';
import { 
    Bold, Italic, Underline as UnderlineIcon, 
    AlignLeft, AlignCenter, AlignRight, AlignJustify,
    List, ListOrdered, Undo, Redo, 
    Save, RotateCcw, FileText, ChevronLeft, ChevronRight, 
    HelpCircle, Image as ImageIcon, Plus, Trash2, Folder, Loader2,
    ArrowLeft, ArrowRight, Minus, Strikethrough, Sliders, Eye, EyeOff,
    ArrowUp, ArrowDown, Layers, AlertTriangle, Info
} from 'lucide-react';

// Deutsche Variablen für globale Verwendung
const GLOBAL_VARIABLES = [
    { id: 'mieter_name', label: 'Mieter Name', icon: '👤', description: 'Der vollständige Name des Hauptmieters.' },
    { id: 'mieter_anrede', label: 'Briefanrede', icon: '✉️', description: 'Die vollständige Briefanrede inklusive Name (z.B. "Sehr geehrte/r Max Mustermann"). Bitte KEIN zusätzliches "Sehr geehrte/r" davor schreiben – die Variable enthält die Anrede bereits.' },
    { id: 'mieter_adresse', label: 'Mieter Adresse', icon: '🏠', description: 'Die vollständige Anschrift des Mieters für das Adressfeld.' },
    { id: 'objekt_name', label: 'Objektname', icon: '🏢', description: 'Der Name des Gebäudes oder Objekts.' },
    { id: 'einheit_name', label: 'Wohneinheit', icon: '🚪', description: 'Die Bezeichnung der Wohneinheit (z.B. "EG links" oder "Wohnung Nr. 5").' },
    { id: 'objekt_adresse', label: 'Objekt-Adresse', icon: '📍', description: 'Die vollständige Adresse des Objekts.' },
    { id: 'vermieter_name', label: 'Vermieter Name', icon: '👤', description: 'Der Name des Vermieters (wird als Absender oder in der Grußformel genutzt).' },
    { id: 'vermieter_adresse', label: 'Vermieter Anschrift', icon: '📮', description: 'Die Anschrift des Vermieters aus dem gewählten Portfolio (Straße, PLZ, Ort).' },
    { id: 'vermieter_kontakt', label: 'Vermieter Kontakt', icon: '☎️', description: 'E-Mail-Adresse und Telefonnummer des Vermieters aus dem gewählten Portfolio.' },
    { id: 'vermieter_bankverbindung', label: 'Vermieter Bankverbindung', icon: '💳', description: 'Die im Portfolio hinterlegte Bank, IBAN und BIC des Vermieters für Zahlungsaufforderungen.' },
    { id: 'rechnungsdatum', label: 'Briefdatum', icon: '📅', description: 'Das Datum des Schreibens (heutiges Datum).' }
];

// Deutsche Variablen für das Mahnwesen
const DUNNING_VARIABLES = [
    ...GLOBAL_VARIABLES,
    { id: 'offener_betrag', label: 'Offener Betrag', icon: '💰', description: 'Der aktuell ausstehende Gesamtbetrag der Mahnung.' },
    { id: 'zahlungsfrist_datum', label: 'Fälligkeitsdatum', icon: '📅', description: 'Das Datum, bis zu dem die Zahlung auf dem Konto eingegangen sein muss.' },
    { id: 'verzugstage', label: 'Verzugstage', icon: '⏱️', description: 'Die Anzahl der Tage, die der Mieter bereits mit der Zahlung im Verzug ist.' },
    { id: 'mahnstufe', label: 'Mahnstufe', icon: '📈', description: 'Die aktuelle Stufe des Mahnverfahrens (z.B. 1, 2 oder Letzte Mahnung).' },
    { id: 'zinsbetrag', label: 'Verzugszinsen', icon: '💸', description: 'Der berechnete Verzugszinsbetrag basierend auf den Verzugstagen.' },
    { id: 'forderungs_tabelle', label: 'Forderungstabelle', icon: '📊', description: 'Eine strukturierte Tabelle, die alle offenen Posten, Mieten und Mahngebühren auflistet.' },
    { id: 'nutzungszeitraum', label: 'Mietbeginn/Nutzungszeitraum', icon: '⏳', description: 'Der Mietbeginn bzw. Nutzungszeitraum des Mieters (in Mahnschreiben als "Mietbeginn" ausgegeben).' },
    { id: 'forderungs_detail_tabelle', label: 'Detaillierte Forderungstabelle', icon: '📋', description: 'Die detaillierte Aufstellung aller Forderungen als Anlage zur Mahnung (Seite 2).' }
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
    { id: 'nebenkosten_tabelle', label: 'Umlagetabelle', icon: '📊', description: 'Die detaillierte Umlagetabelle der Betriebskosten mit Kostenarten, Gesamtkosten, Umlageschlüsseln und Mieteranteil.' },
    { id: 'nebenkosten_detail_tabelle', label: 'Detaillierte Umlagetabelle', icon: '📋', description: 'Das detaillierte Berechnungsblatt der Nebenkosten als Anlage (Seite 2).' }
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
    { id: 'mwst_betrag', label: 'MwSt-Betrag', icon: '💸', description: 'Der berechnete Umsatzsteuerbetrag laut Rechnung (Steuersatz je Position aus den Rechnungsdaten).' },
    { id: 'brutto_betrag', label: 'Gesamtbetrag (Brutto)', icon: '💵', description: 'Der Endbetrag inklusive Umsatzsteuer.' },
    { id: 'original_rechnungsnummer', label: 'Ref-Rechnungsnummer', icon: '📎', description: 'Bei einer Stornierung oder Korrektur die Nummer der Originalrechnung.' },
    { id: 'positions_tabelle', label: 'Rechnungspositionen-Tabelle', icon: '📊', description: 'Eine Tabelle mit allen Rechnungspositionen wie Übernachtungskosten, Reinigung und Zusatzleistungen.' },
    { id: 'vermieter_name', label: 'Vermieter Name', icon: '👤', description: 'Der Name des Vermieters.' },
    { id: 'vermieter_adresse', label: 'Vermieter Anschrift', icon: '📮', description: 'Die vollständige Anschrift des leistenden Unternehmers (Pflichtangabe nach § 14 Abs. 4 UStG).' },
    { id: 'vermieter_kontakt', label: 'Vermieter Kontakt', icon: '☎️', description: 'E-Mail-Adresse und Telefonnummer des Vermieters.' },
    { id: 'vermieter_bankverbindung', label: 'Vermieter Bankverbindung', icon: '💳', description: 'Die IBAN und BIC des Vermieters für die Überweisung.' },
    { id: 'vermieter_steuernummer', label: 'Vermieter Steuernummer', icon: '📝', description: 'Die Steuernummer des Vermieters für steuerliche Zwecke.' },
    { id: 'vermieter_ust_id', label: 'Vermieter USt-IdNr.', icon: '🆔', description: 'Die Umsatzsteuer-Identifikationsnummer des Vermieters.' },
    { id: 'vermieter_steuer_angabe', label: 'Steuernummer / USt-IdNr.', icon: '🧾', description: 'Steuernummer und/oder USt-IdNr. des Vermieters (Pflichtangabe nach § 14 Abs. 4 Nr. 2 UStG); fehlt beides, wird es markiert.' },
    { id: 'objekt_adresse', label: 'Objekt-Adresse', icon: '📍', description: 'Die Adresse des Objekts (z.B. im Absender der Fewo-Rechnung).' }
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
    { id: 'einzug_datum', label: 'Einzugsdatum', icon: '📅', description: 'Das Einzugsdatum des Mieters (Mietbeginn laut Mietvertrag).' }
];

// Deutsche Variablen für Verträge (zusätzlich Miete und Kaution aus dem Mietvertrag)
const CONTRACT_VARIABLES = [
    ...CERTIFICATE_VARIABLES,
    { id: 'aktuelle_miete', label: 'Nettokaltmiete', icon: '💵', description: 'Die im Mietvertrag hinterlegte monatliche Nettokaltmiete.' },
    { id: 'kaution_betrag', label: 'Kaution', icon: '🔐', description: 'Die im Mietvertrag hinterlegte Kaution.' }
];

// Variablen, die in keiner Palette stehen, aber in Vorlagen vorkommen können
const EXTRA_VARIABLES = [
    { id: 'mieter_nachname', label: 'Mieter Nachname' },
    { id: 'vermieter_email', label: 'Vermieter E-Mail' },
    { id: 'vermieter_telefon', label: 'Vermieter Telefon' },
    { id: 'rechnungs_datum', label: 'Rechnungsdatum' },
    { id: 'erstellungsdatum', label: 'Erstellungsdatum' },
    { id: 'storno_nummer', label: 'Storno-Nummer' }
];

const DEFAULT_TEMPLATES = {
    payment_reminder: {
        name: 'Zahlungserinnerung',
        category: 'Mahnwesen',
        subject: 'Zahlungserinnerung zu offenen Mietforderungen',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date"><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Zahlungserinnerung zu offenen Mietforderungen</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p><span data-type="mention" data-id="mieter_anrede" data-label="Briefanrede">Briefanrede</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Bezüglich der offenen Posten besteht aktuell ein Zahlungsrückstand.</p><p>Trotz Fälligkeit wurde die nachfolgend aufgeführte Forderung nicht vollständig ausgeglichen. Bitte prüfen Sie den Vorgang und gleichen Sie den offenen Betrag aus.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-body"><p style="font-size: 12pt; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</p><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    dunning_1: {
        name: 'Mahnung (Stufe 1)',
        category: 'Mahnwesen',
        subject: 'Mahnung wegen Mietrückstand',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date"><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Mahnung wegen Mietrückstand</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p><span data-type="mention" data-id="mieter_anrede" data-label="Briefanrede">Briefanrede</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-body"><p style="font-size: 12pt; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</p><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    dunning_2: {
        name: 'Abmahnung (Stufe 2)',
        category: 'Mahnwesen',
        subject: 'Abmahnung und Zahlungsaufforderung wegen Zahlungsverzug',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date"><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Abmahnung und Zahlungsaufforderung wegen Zahlungsverzug</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p><span data-type="mention" data-id="mieter_anrede" data-label="Briefanrede">Briefanrede</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Aufgrund der Höhe des Rückstands kann zudem die Prüfung einer außerordentlichen fristlosen Kündigung gemäß § 543 Abs. 2 Nr. 3 BGB, hilfsweise einer ordentlichen Kündigung, in Betracht kommen. Für Wohnraummietverhältnisse sind zusätzlich die Regelungen des § 569 BGB zu beachten.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-body"><p style="font-size: 12pt; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</p><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    dunning_final: {
        name: 'Letzte Zahlungsaufforderung',
        category: 'Mahnwesen',
        subject: 'Letzte Zahlungsaufforderung vor weiteren Schritten',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date"><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Letzte Zahlungsaufforderung vor weiteren Schritten</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p><span data-type="mention" data-id="mieter_anrede" data-label="Briefanrede">Briefanrede</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Mietbeginn">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-body"><p style="font-size: 12pt; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</p><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    utility_costs: {
        name: 'Nebenkostenabrechnung',
        category: 'Nebenkosten',
        subject: 'Betriebskostenabrechnung für das Abrechnungsjahr',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date"><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Betriebskostenabrechnung für das Abrechnungsjahr <span data-type="mention" data-id="abrechnungsjahr" data-label="Abrechnungsjahr">Abrechnungsjahr</span></div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p><span data-type="mention" data-id="mieter_anrede" data-label="Briefanrede">Briefanrede</span>,</p><p>anbei erhalten Sie die ordnungsgemäße Betriebskostenabrechnung für Ihr Mietobjekt <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>) für das Abrechnungsjahr <strong><span data-type="mention" data-id="abrechnungsjahr" data-label="Abrechnungsjahr">Abrechnungsjahr</span></strong>.</p><p>Die Abrechnung wurde auf der Grundlage der mietvertraglichen Vereinbarungen und der gesetzlichen Bestimmungen der Betriebskostenverordnung (BetrKV) erstellt. Ihr Nutzungszeitraum belief sich dabei auf <strong><span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Nutzungszeitraum</span></strong>.</p><p>Die Zusammenfassung der Gesamtkosten sowie das Abrechnungsergebnis entnehmen Sie bitte der nachfolgenden Aufstellung:</p><p><span data-type="mention" data-id="nebenkosten_tabelle" data-label="Umlagetabelle">Umlagetabelle</span></p><p>Daraus ergibt sich für Sie ein Saldo in Höhe von <strong><span data-type="mention" data-id="saldo_betrag" data-label="Saldo (Ergebnis)">Saldo (Ergebnis)</span></strong> als <strong><span data-type="mention" data-id="saldo_art" data-label="Saldo Art (Nachzahlung/Gutschrift)">Saldo Art (Nachzahlung/Gutschrift)</span></strong>.</p><p><strong>Zahlungshinweis:</strong> Im Falle einer Nachzahlung bitten wir Sie, den ausstehenden Betrag innerhalb von 30 Tagen auf unser bekanntes Vermieterkonto unter Angabe des Verwendungszwecks zu überweisen. Eine etwaige Gutschrift wird mit der nächsten fälligen Mietzahlung verrechnet oder auf Ihr uns bekanntes Konto ausgezahlt.</p><p>Die detaillierte Aufteilung der einzelnen Kostenpositionen, der Umlageschlüssel und der Berechnungsschritte können Sie dem beigefügten Berechnungsblatt (Seite 2) entnehmen.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-body"><p style="font-size: 12pt; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Betriebskostenabrechnung: Berechnungsblatt</p><p>Nachfolgend finden Sie die detaillierte Aufstellung der Betriebskosten, die Umlageschlüssel und die Berechnungsschritte für Ihren Nutzungszeitraum:</p><p><span data-type="mention" data-id="nebenkosten_detail_tabelle" data-label="Detaillierte Umlagetabelle">Detaillierte Umlagetabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    fewo_invoice: {
        name: 'Fewo-Rechnung',
        category: 'FEWO-Rechnungen',
        subject: 'Rechnung über erbrachte Leistungen für Ihren Aufenthalt',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="vermieter_adresse" data-label="Vermieter Anschrift">Vermieter Anschrift</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="gast_name" data-label="Gast-Name">Gast-Name</span></strong><br><span data-type="mention" data-id="gast_adresse" data-label="Gast-Adresse">Gast-Adresse</span></div><div class="letter-date" style="text-align: right; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 10pt; line-height: 1.4;">Nummer: <strong><span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></strong><br>Datum: <strong><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></strong><br>Zeitraum: <strong><span data-type="mention" data-id="buchungszeitraum" data-label="Buchungszeitraum">Buchungszeitraum</span></strong><br><span data-type="mention" data-id="vermieter_steuer_angabe" data-label="Steuernummer / USt-IdNr.">Steuernummer / USt-IdNr.</span></div></div><div class="letter-subject">Rechnung Nr. <span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></div><div class="letter-body"><p>Sehr geehrte Damen und Herren,</p><p>wir bedanken uns herzlich für Ihren Aufenthalt in unserem Hause. Vereinbarungsgemäß erlauben wir uns, Ihnen die erbrachten Leistungen in Rechnung zu stellen:</p><p><span data-type="mention" data-id="positions_tabelle" data-label="Rechnungspositionen-Tabelle">Rechnungspositionen-Tabelle</span></p><p>Bitte überweisen Sie den fälligen Gesamtbetrag innerhalb von 14 Tagen auf unser angegebenes Bankkonto.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span><br><span data-type="mention" data-id="vermieter_adresse" data-label="Vermieter Anschrift">Vermieter Anschrift</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    fewo_credit_note: {
        name: 'Fewo-Gutschrift',
        category: 'FEWO-Rechnungen',
        subject: 'Gutschrift zu Ihrem Aufenthalt',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="vermieter_adresse" data-label="Vermieter Anschrift">Vermieter Anschrift</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="gast_name" data-label="Gast-Name">Gast-Name</span></strong><br><span data-type="mention" data-id="gast_adresse" data-label="Gast-Adresse">Gast-Adresse</span></div><div class="letter-date" style="text-align: right; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 10pt; line-height: 1.4;">Nummer: <strong><span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></strong><br>Datum: <strong><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></strong><br>Zeitraum: <strong><span data-type="mention" data-id="buchungszeitraum" data-label="Buchungszeitraum">Buchungszeitraum</span></strong><br><span data-type="mention" data-id="vermieter_steuer_angabe" data-label="Steuernummer / USt-IdNr.">Steuernummer / USt-IdNr.</span></div></div><div class="letter-subject">Gutschrift Nr. <span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span> zur Rechnung Nr. <span data-type="mention" data-id="original_rechnungsnummer" data-label="Ref-Rechnungsnummer">Ref-Rechnungsnummer</span></div><div class="letter-body"><p>Sehr geehrte Damen und Herren,</p><p>vereinbarungsgemäß erhalten Sie nachfolgend die Gutschrift für Ihren Aufenthalt bzw. Ihre Buchung:</p><p><span data-type="mention" data-id="positions_tabelle" data-label="Rechnungspositionen-Tabelle">Rechnungspositionen-Tabelle</span></p><p>Der Gutschriftbetrag wird Ihrem Konto in den nächsten Tagen gutgeschrieben oder vereinbarungsgemäß verrechnet.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span><br><span data-type="mention" data-id="vermieter_adresse" data-label="Vermieter Anschrift">Vermieter Anschrift</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
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
        content_html: `<div class="letter-page"><div class="letter-body"><h2 style="text-align: center; font-size: 16px; font-weight: bold;">Mietvertrag für Gewerberäume</h2><p>Zwischen dem Vermieter: <strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong><br>und dem Mieter: <strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong> wird folgender Gewerbemietvertrag geschlossen:</p><p><b>§ 1 Mietobjekt & Nutzungszweck</b><br>Vermietet werden die Gewerberäume in der <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong>, Einheit: <strong><span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span></strong>. Die Räume dürfen ausschließlich als ________________ genutzt werden.</p><p><b>§ 2 Mietzeit</b><br>Das Mietverhältnis beginnt am <strong><span data-type="mention" data-id="einzug_datum" data-label="Einzugsdatum">Einzugsdatum</span></strong> und läuft fest bis zum ____________. Es verlängert sich um jeweils 1 Jahr, wenn es nicht 6 Monate vor Ablauf gekündigt wird.</p><p><b>§ 3 Miete & Wertsicherung (Indexierung)</b><br>Die monatliche Nettomiete beträgt ________________ EUR zzgl. gesetzlicher USt. Wertsicherung (Indexierung): ______________________________________________ (bitte vollständig ausformulieren – Bezugsindex mit Basisjahr, Schwellenwert, Art und Zeitpunkt der Anpassung – und vor Vertragsschluss rechtlich prüfen lassen).</p><p><b>§ 4 Betriebskosten</b><br>Der Mieter trägt alle Betriebskosten im Sinne des § 2 BetrKV sowie sämtliche auf das Gebäude und Grundstück entfallenden Sach- und Haftpflichtversicherungen sowie die Grundsteuer.</p><p><b>§ 5 Umbau & Instandhaltung</b><br>Bauliche Veränderungen durch den Mieter bedürfen der vorherigen schriftlichen Zustimmung des Vermieters. Der Mieter haftet für alle Schäden.</p><p><br>Ort, Datum: ___________________________<br><br><br>Unterschriften:<br><br>______________________ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ______________________<br>Vermieter &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Mieter</p></div></div>`
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
        subject: 'Mieterhöhungsverlangen – Bitte um Zustimmung nach § 558 BGB',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><hr class="editor-hr" /><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date"><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Mieterhöhungsverlangen – Bitte um Zustimmung nach § 558 BGB</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p><span data-type="mention" data-id="mieter_anrede" data-label="Briefanrede">Briefanrede</span>,</p><p>für die von Ihnen gemietete Wohnung im Mietobjekt <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>) bitte ich Sie hiermit gemäß § 558 BGB um Ihre Zustimmung zur Erhöhung der Nettokaltmiete bis zur ortsüblichen Vergleichsmiete.</p><p>Ihre derzeitige Nettokaltmiete beträgt monatlich <strong><span data-type="mention" data-id="aktuelle_miete" data-label="Aktuelle Miete">Aktuelle Miete</span></strong>. Ich bitte Sie, einer Erhöhung um <strong><span data-type="mention" data-id="erhoehungs_betrag" data-label="Erhöhungsbetrag">Erhöhungsbetrag</span></strong> auf monatlich <strong><span data-type="mention" data-id="neue_miete" data-label="Neue Miete">Neue Miete</span></strong> mit Wirkung ab dem <strong><span data-type="mention" data-id="erhoehungs_datum" data-label="Wirksamkeitsdatum">Wirksamkeitsdatum</span></strong> zuzustimmen.</p><p><strong>Begründung (§ 558a BGB):</strong> ______________________________________________ (bitte ergänzen, z.B. Mietspiegel mit genauer Bezeichnung und Einordnung der Wohnung, Sachverständigengutachten oder Benennung von drei Vergleichswohnungen).</p><p>Bitte senden Sie mir die beiliegende Zustimmungserklärung bis zum <strong><span data-type="mention" data-id="zustimmungs_frist" data-label="Zustimmungsfrist">Zustimmungsfrist</span></strong> unterschrieben zurück. Auf Ihr Sonderkündigungsrecht nach § 561 BGB weise ich hin.</p><p>Für Rückfragen stehen wir Ihnen gerne zur Verfügung.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
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
        content_html: `<div class="letter-page"><div class="letter-body"><h2 style="text-align: center; font-size: 16px; font-weight: bold;">Wohnungsgeberbestätigung nach § 19 Bundesmeldegesetz (BMG)</h2><p>Hiermit wird der <strong>Einzug</strong> der nachfolgenden Personen in die unten bezeichnete Wohnung bestätigt:</p><p><b>Eingezogene Personen:</b><br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong></p><p><b>Einzugsdatum:</b><br><strong><span data-type="mention" data-id="einzug_datum" data-label="Einzugsdatum">Einzugsdatum</span></strong></p><p><b>Anschrift der Wohnung:</b><br><strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong> (Einheit: <strong><span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span></strong>)</p><p><b>Name und Anschrift des Wohnungsgebers (Eigentümer / Vermieter):</b><br><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong><br><span data-type="mention" data-id="vermieter_adresse" data-label="Vermieter Anschrift">Vermieter Anschrift</span></p><p style="font-size: 9px; color: #475569; margin-top: 15px;">Hinweis: Die Ausstellung dieser Bestätigung entspricht der gesetzlichen Auskunftspflicht des Wohnungsgebers gem. § 19 BMG. Unrichtige Angaben können als Ordnungswidrigkeit geahndet werden.</p><p><br>Ort, Datum: ___________________________<br><br><br>______________________________________<br>Unterschrift des Wohnungsgebers</p></div></div>`
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
        content_html: `<div class="letter-page"><div class="letter-body"><p><span data-type="mention" data-id="mieter_anrede" data-label="Briefanrede">Briefanrede</span>,</p><p>hiermit bestätige ich den Erhalt Ihrer schriftlichen Kündigung vom ______________ für das Mietverhältnis über die Wohnung/Einheit <strong><span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span></strong> in der <strong><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></strong>.</p><p>Das Mietverhältnis endet vertragsgemäß mit Ablauf des ______________.</p><p>Bezüglich des Termins zur Wohnungsübergabe und Erstellung des Übergabeprotokolls werden wir uns rechtzeitig mit Ihnen in Verbindung setzen, um einen gemeinsamen Termin abzustimmen.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div></div>`
    }
};

// Ordnet Vorlagen (System und eigene) die zur Kategorie passende Variablen-Palette zu.
// Einzige Quelle der Zuordnung (vorher zusätzlich je Systemvorlage, teils abweichend).
const VARIABLES_BY_CATEGORY = {
    'Mahnwesen': DUNNING_VARIABLES,
    'Nebenkosten': UTILITY_VARIABLES,
    'FEWO-Rechnungen': INVOICE_VARIABLES,
    'Mieterhöhung': RENT_INCREASE_VARIABLES,
    'Bescheinigungen': CERTIFICATE_VARIABLES,
    'Verträge': CONTRACT_VARIABLES,
};
const getVariablesForCategory = (category) => VARIABLES_BY_CATEGORY[category] || GLOBAL_VARIABLES;

const SYSTEM_TEMPLATE_LIST = [
    { id: 'payment_reminder', label: 'Zahlungserinnerung', hasSubject: true, group: 'Mahnwesen' },
    { id: 'dunning_1', label: 'Mahnung (Stufe 1)', hasSubject: true, group: 'Mahnwesen' },
    { id: 'dunning_2', label: 'Abmahnung (Stufe 2)', hasSubject: true, group: 'Mahnwesen' },
    { id: 'dunning_final', label: 'Letzte Zahlungsaufforderung', hasSubject: true, group: 'Mahnwesen' },
    { id: 'utility_costs', label: 'Nebenkostenabrechnung', hasSubject: true, group: 'Nebenkosten' },
    { id: 'fewo_invoice', label: 'Fewo-Rechnung', hasSubject: true, group: 'FEWO-Rechnungen' },
    { id: 'fewo_credit_note', label: 'Fewo-Gutschrift', hasSubject: true, group: 'FEWO-Rechnungen' },
    { id: 'lease_residential', label: 'Mietvertrag Wohnraum', hasSubject: true, group: 'Verträge' },
    { id: 'lease_commercial', label: 'Mietvertrag Gewerbe', hasSubject: true, group: 'Verträge' },
    { id: 'lease_garage', label: 'Mietvertrag Garagen & Stellplätze', hasSubject: true, group: 'Verträge' },
    { id: 'rent_increase', label: 'Mieterhöhungsschreiben', hasSubject: true, group: 'Mieterhöhung' },
    { id: 'rent_increase_consent', label: 'Zustimmungserklärung', hasSubject: true, group: 'Mieterhöhung' },
    { id: 'landlord_confirmation', label: 'Wohnungsgeberbestätigung', hasSubject: true, group: 'Bescheinigungen' },
    { id: 'rent_clearance_certificate', label: 'Mietschuldenfreiheitsbescheinigung', hasSubject: true, group: 'Bescheinigungen' },
    { id: 'rental_guarantee', label: 'Mietbürgschaft', hasSubject: true, group: 'Bescheinigungen' },
    { id: 'termination_receipt', label: 'Kündigungsbestätigung', hasSubject: true, group: 'Bescheinigungen' }
];
const SYSTEM_TEMPLATES = SYSTEM_TEMPLATE_LIST.map(t => ({ ...t, variables: getVariablesForCategory(t.group) }));

// =============================================================================
// Platzhalter (Variablen): neutral speichern – an EINER Stelle auflösen
// -----------------------------------------------------------------------------
// - Gespeichert wird ein Platzhalter nur noch neutral als
//   <span class="variable-chip" data-type="mention" data-id="…" data-label="…">Label</span>
//   (keine Beispielwerte, keine Zeilenumbrüche, keine verschachtelten Tabellen). Damit greifen
//   auch die Ersetzer in Mahnungen, Rechnungen und Nebenkostenabrechnungen zuverlässig.
// - Editor-Anzeige (NodeView), Live-Vorschau und Druckfenster nutzen dieselben Werte
//   (buildVariableValues) und denselben Renderer (renderVariableInto / resolveTemplateHtml).
// - Werte werden ausschließlich als Text eingesetzt (Textknoten, Zeilenumbruch als <br>).
//   HTML sind nur die intern erzeugten Beispieltabellen.
// - Fehlende Angaben werden NIE mit Musterwerten gefüllt, sondern sichtbar rot markiert.
// =============================================================================
const PAGINATION_META = 'immoTemplatePagination';
const EMPTY_MANUAL_VALUES = Object.freeze({});
const TEMPLATE_LOAD_META = 'immoTemplateLoad';
const VARIABLE_DRAG_MIME = 'application/x-immo-variable';

const TABLE_VARIABLE_IDS = new Set(['forderungs_tabelle', 'forderungs_detail_tabelle', 'nebenkosten_tabelle', 'nebenkosten_detail_tabelle', 'positions_tabelle']);
const MULTILINE_VARIABLE_IDS = new Set(['mieter_adresse', 'gast_adresse', 'vermieter_bankverbindung', 'vermieter_kontakt', 'vermieter_steuer_angabe']);

const VARIABLE_LABELS = (() => {
    const map = {};
    [GLOBAL_VARIABLES, DUNNING_VARIABLES, UTILITY_VARIABLES, INVOICE_VARIABLES, RENT_INCREASE_VARIABLES, CERTIFICATE_VARIABLES, CONTRACT_VARIABLES, EXTRA_VARIABLES]
        .forEach(list => list.forEach(v => { if (!map[v.id]) map[v.id] = v.label; }));
    return map;
})();
const isKnownVariableId = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(VARIABLE_LABELS, id);
const variableLabel = (id, label) => label || VARIABLE_LABELS[id] || id || 'Platzhalter';

// Beispielwerte NUR für die reine Vorlagen-Vorschau (ohne Mieter). Sie werden in Vorschau und
// Druck gelb markiert. Vermieter-, Bank- und Kontaktdaten gehören bewusst NICHT dazu – sie
// kommen ausschließlich aus dem gewählten Portfolio (sonst: rote Markierung „fehlt“).
const EXAMPLE_VALUES = {
    mieter_name: 'Max Mustermann',
    mieter_nachname: 'Mustermann',
    mieter_anrede: 'Sehr geehrter Herr Mustermann',
    mieter_adresse: 'Musterweg 12\n12345 Musterstadt',
    gast_name: 'Dr. Sabine Sommer',
    gast_adresse: 'Lindenallee 7\n50667 Köln',
    objekt_name: 'Wohnpark Sonnenseite',
    einheit_name: 'Wohnung EG links',
    objekt_adresse: 'Musterstraße 42, 12345 Musterstadt',
    offener_betrag: '908,70 €',
    verzugstage: '14',
    mahnstufe: '2',
    zinsbetrag: '3,70 €',
    abrechnungsjahr: '2025',
    abrechnungszeitraum: '01.01.2025 - 31.12.2025',
    nutzungszeitraum: '01.01.2025 - 31.12.2025',
    gesamtkosten_mieter: '550,00 €',
    vorauszahlungs_betrag: '400,00 €',
    saldo_betrag: '150,00 €',
    saldo_art: 'Nachzahlung',
    kaution_betrag: '1.950,00 €',
    buchungszeitraum: '15.05.2026 - 22.05.2026',
    gaeste_anzahl: '2',
    rechnungsnummer: 'RE-2026-0412',
    netto_betrag: '560,75 €',
    mwst_betrag: '39,25 €',
    brutto_betrag: '600,00 €',
    original_rechnungsnummer: 'RE-2026-0399',
    storno_nummer: 'ST-2026-0001',
    aktuelle_miete: '650,00 €',
    neue_miete: '715,00 €',
    erhoehungs_betrag: '65,00 €',
    erhoehungs_datum: '01.08.2026',
    zustimmungs_frist: '31.07.2026',
    einzug_datum: '01.06.2026'
};

// Whitespace zwischen Tags entfernen: der Editor arbeitet mit white-space: pre-wrap, dort
// würden Einrückungen in Tabellen sonst als leere Tabellenzellen/-zeilen erscheinen.
const compactHtml = (html) => String(html).replace(/>\s+</g, '><').trim();

const EXAMPLE_TABLES_RAW = {
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
const EXAMPLE_TABLES = Object.fromEntries(Object.entries(EXAMPLE_TABLES_RAW).map(([id, html]) => [id, compactHtml(html)]));

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';
const joinParts = (parts, separator) => parts
    .map(part => (part === null || part === undefined ? '' : String(part).trim()))
    .filter(Boolean)
    .join(separator);
const textValue = (text, extra = {}) => (isBlank(text) ? null : { text: String(text).trim(), ...extra });

const formatDateValue = (value) => {
    if (isBlank(value)) return null;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('de-DE');
};

const formatEuroValue = (value) => {
    if (isBlank(value)) return null;
    const num = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(num) && num > 0
        ? num.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
        : null;
};

const getDateStrings = () => {
    const now = new Date();
    return {
        today: now.toLocaleDateString('de-DE'),
        inTwoWeeks: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString('de-DE')
    };
};

// Liefert je Variable: { text } (wird als Text eingesetzt), { html } (nur interne Tabellen)
// oder null (= Angabe fehlt → rote Markierung). example = Beispielwert, manual = vom Nutzer eingetragen.
const buildVariableValues = ({ tenant, portfolio, manualValues, group, dates }) => {
    const values = {};
    const p = portfolio || null;

    // Briefdatum: das heutige Datum (echter Wert, kein Beispiel)
    ['rechnungsdatum', 'rechnungs_datum', 'erstellungsdatum'].forEach(id => { values[id] = textValue(dates.today); });

    // Vermieter: ausschließlich aus dem gewählten Portfolio – keine Musterwerte
    values.vermieter_name = textValue(p ? (p.company_name || p.name) : null);
    values.vermieter_adresse = textValue(p ? joinParts([joinParts([p.street, p.house_number], ' '), joinParts([p.zip, p.city], ' ')], ', ') : null);
    values.vermieter_bankverbindung = p && !isBlank(p.iban)
        ? textValue(joinParts([p.bank_name, `IBAN: ${String(p.iban).trim()}`, isBlank(p.bic) ? '' : `BIC: ${String(p.bic).trim()}`], '\n'))
        : null;
    values.vermieter_email = textValue(p?.email);
    values.vermieter_telefon = textValue(p?.phone);
    values.vermieter_kontakt = textValue(joinParts([
        isBlank(p?.email) ? '' : `E-Mail: ${String(p.email).trim()}`,
        isBlank(p?.phone) ? '' : `Tel.: ${String(p.phone).trim()}`
    ], '\n'));
    values.vermieter_steuernummer = textValue(p?.tax_number);
    values.vermieter_ust_id = textValue(p?.vat_id);
    values.vermieter_steuer_angabe = textValue(joinParts([
        isBlank(p?.tax_number) ? '' : `Steuernummer: ${String(p.tax_number).trim()}`,
        isBlank(p?.vat_id) ? '' : `USt-IdNr.: ${String(p.vat_id).trim()}`
    ], '\n'));

    if (!tenant) {
        // Reine Vorlagen-Vorschau: Beispieldaten für Mieter/Vorgang, deutlich als Beispiel markiert
        Object.entries(EXAMPLE_VALUES).forEach(([id, text]) => { values[id] = { text, example: true }; });
        values.zahlungsfrist_datum = { text: dates.inTwoWeeks, example: true };
        Object.entries(EXAMPLE_TABLES).forEach(([id, html]) => { values[id] = { html, example: true }; });
        return values;
    }

    // Echtdaten ("Dokument erstellen" beim Mieter): nur echte Mieter-/Vertragsdaten.
    // Alles andere (neue Miete, Fristen, Beträge, Tabellen …) bleibt leer und wird markiert.
    const t = tenant;
    const firstName = String(t.first_name || '').trim();
    const lastName = String(t.last_name || '').trim();
    const fullName = joinParts([firstName, lastName], ' ');
    values.mieter_name = textValue(fullName);
    values.mieter_nachname = textValue(lastName);
    let salutation = 'Sehr geehrte Damen und Herren';
    if (fullName) {
        if (t.gender === 'female' && lastName) salutation = `Sehr geehrte Frau ${lastName}`;
        else if (t.gender === 'male' && lastName) salutation = `Sehr geehrter Herr ${lastName}`;
        else salutation = `Sehr geehrte/r ${fullName}`;
    }
    values.mieter_anrede = { text: salutation };
    values.mieter_adresse = textValue(joinParts([
        joinParts([t.street, t.house_number], ' '),
        joinParts([t.zip, t.city], ' ')
    ], '\n'));

    // Objektadresse: eigene Felder (falls übergeben), sonst die Adressfelder (= Objektadresse)
    const hasObjectFields = ['objekt_strasse', 'objekt_hausnummer', 'objekt_plz', 'objekt_ort']
        .some(key => Object.prototype.hasOwnProperty.call(t, key));
    const objectStreet = hasObjectFields ? joinParts([t.objekt_strasse, t.objekt_hausnummer], ' ') : joinParts([t.street, t.house_number], ' ');
    const objectCity = hasObjectFields ? joinParts([t.objekt_plz, t.objekt_ort], ' ') : joinParts([t.zip, t.city], ' ');
    values.objekt_adresse = textValue(joinParts([objectStreet, objectCity], ', '));
    values.objekt_name = textValue(t.objekt_name);
    values.einheit_name = textValue(t.einheit_name);
    values.aktuelle_miete = textValue(formatEuroValue(t.cold_rent));
    values.kaution_betrag = textValue(formatEuroValue(t.deposit));
    const startDate = formatDateValue(t.einzug_datum || t.start_date || t.move_in || t.lease_start);
    values.einzug_datum = textValue(startDate);
    // In Mahnschreiben steht der Platzhalter für den Mietbeginn
    if (group === 'Mahnwesen') values.nutzungszeitraum = textValue(startDate);

    // Vom Nutzer für dieses Dokument eingetragene Angaben (werden nicht in der Vorlage gespeichert)
    Object.entries(manualValues || {}).forEach(([id, text]) => {
        if (!isBlank(text) && !TABLE_VARIABLE_IDS.has(id)) values[id] = { text: String(text), manual: true };
    });
    return values;
};

const lookupVariable = (values, id) => (values && Object.prototype.hasOwnProperty.call(values, id) ? values[id] : null);

const appendTextWithBreaks = (doc, parent, text) => {
    String(text).split(/\r?\n/).forEach((line, idx) => {
        if (idx > 0) parent.appendChild(doc.createElement('br'));
        parent.appendChild(doc.createTextNode(line));
    });
};

// Füllt "target" mit dem Wert eines Platzhalters. Einzige Stelle, an der Werte eingesetzt werden.
const renderVariableInto = (doc, target, entry, label, { markExamples = false } = {}) => {
    while (target.firstChild) target.removeChild(target.firstChild);
    if (!entry) {
        const marker = doc.createElement('span');
        marker.className = 'tpl-missing';
        marker.textContent = `[${label} fehlt]`;
        target.appendChild(marker);
        return;
    }
    if (typeof entry.html === 'string') {
        // nur intern erzeugtes HTML (Beispieltabellen), nie Nutzer- oder Mieterdaten
        target.innerHTML = entry.html;
        return;
    }
    let host = target;
    if (markExamples && entry.example) {
        host = doc.createElement('span');
        host.className = 'tpl-example';
        target.appendChild(host);
    }
    appendTextWithBreaks(doc, host, entry.text);
};

const forEachTextNode = (root, callback) => {
    const doc = root.ownerDocument || root;
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(callback);
};

const createNeutralChip = (doc, id) => {
    const chip = doc.createElement('span');
    const label = variableLabel(id);
    chip.className = 'variable-chip';
    chip.setAttribute('data-type', 'mention');
    chip.setAttribute('data-id', id);
    chip.setAttribute('data-label', label);
    chip.textContent = label;
    return chip;
};

// Die Variable "mieter_anrede" enthält die vollständige Anrede. Ein davor geschriebenes
// "Sehr geehrte/r " führte zu "Sehr geehrte/r Sehr geehrte/r …" – wird hier entfernt.
const SALUTATION_BEFORE_CHIP_RE = /Sehr geehrte(?:\/r|\(r\))?\s*$/i;
const SALUTATION_BEFORE_BRACE_RE = /Sehr geehrte(?:\/r|\(r\))?\s*(?=\{mieter_anrede\})/gi;
const stripDuplicateSalutations = (root) => {
    let changed = false;
    root.querySelectorAll('span[data-type="mention"][data-id="mieter_anrede"]').forEach(chip => {
        const prev = chip.previousSibling;
        if (prev && prev.nodeType === 3 && SALUTATION_BEFORE_CHIP_RE.test(prev.nodeValue)) {
            prev.nodeValue = prev.nodeValue.replace(SALUTATION_BEFORE_CHIP_RE, '');
            changed = true;
        }
    });
    forEachTextNode(root, (node) => {
        if (!node.nodeValue || node.nodeValue.indexOf('{mieter_anrede}') === -1) return;
        const next = node.nodeValue.replace(SALUTATION_BEFORE_BRACE_RE, '');
        if (next !== node.nodeValue) { node.nodeValue = next; changed = true; }
    });
    return changed;
};

// Block-Werte (Tabellen) dürfen nicht in einem <p> stehen (der HTML-Parser würde den Absatz
// aufbrechen und leere Absätze erzeugen). Steht der Platzhalter allein im Absatz, ersetzt der
// Block den Absatz; sonst wird der Absatz um den Block herum geteilt.
const placeBlockElement = (marker, block) => {
    const paragraph = marker.closest ? marker.closest('p') : null;
    if (!paragraph || !paragraph.parentNode) {
        marker.replaceWith(block);
        return;
    }
    const restText = (paragraph.textContent || '').replace(marker.textContent || '', '').trim();
    if (restText === '' && !paragraph.querySelector('img')) {
        paragraph.replaceWith(block);
        return;
    }
    let top = marker;
    while (top.parentNode !== paragraph) top = top.parentNode;
    const after = paragraph.cloneNode(false);
    let next = top.nextSibling;
    while (next) {
        const following = next.nextSibling;
        after.appendChild(next);
        next = following;
    }
    marker.remove();
    paragraph.after(block);
    if ((after.textContent || '').trim() !== '' || after.querySelector('img')) block.after(after);
    if ((paragraph.textContent || '').trim() === '' && !paragraph.querySelector('img')) paragraph.remove();
};

const createBlockElement = (doc, entry) => {
    const block = doc.createElement('div');
    block.className = entry.example ? 'tpl-block tpl-example-block' : 'tpl-block';
    block.innerHTML = entry.html;
    return block;
};

// Aktive Inhalte (Skripte, Event-Handler, javascript:-URLs, eingebettete Objekte) entfernen.
const BLOCKED_TAGS = new Set([
    'SCRIPT', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'LINK', 'META', 'BASE', 'STYLE',
    'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH'
]);
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'background', 'poster', 'srcset', 'data', 'lowsrc', 'dynsrc', 'ping', 'cite', 'longdesc']);
const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp);/i;
const isSafeUrlValue = (value, attrName) => {
    // eslint-disable-next-line no-control-regex
    const normalized = String(value || '').replace(/[\u0000- ]+/g, '').toLowerCase();
    if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')) return false;
    if (normalized.startsWith('data:')) return attrName === 'src' && SAFE_DATA_IMAGE_RE.test(normalized);
    return true;
};
const sanitizeDom = (root) => {
    Array.from(root.querySelectorAll('*')).forEach(el => {
        if (BLOCKED_TAGS.has(String(el.nodeName).toUpperCase())) {
            el.remove();
            return;
        }
        Array.from(el.attributes).forEach(attr => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
                el.removeAttribute(attr.name);
            } else if (URL_ATTRS.has(name) && !isSafeUrlValue(attr.value, name)) {
                el.removeAttribute(attr.name);
            } else if (name === 'style' && /expression\s*\(|javascript:|behavior\s*:|url\s*\(|@import/i.test(attr.value)) {
                el.removeAttribute(attr.name);
            }
        });
    });
};

const parseHtmlDocument = (html) => new window.DOMParser().parseFromString(
    `<!DOCTYPE html><html><head></head><body>${html}</body></html>`, 'text/html'
);

const BRACE_PLACEHOLDER_RE = /\{([a-z0-9_]+)\}/g;

// Löst alle Platzhalter (Chips und {kennung}) auf. Ergebnis: bereinigtes HTML, Liste fehlender
// Angaben und ob Beispielwerte enthalten sind. Wird von Live-Vorschau UND Druckfenster genutzt.
const resolveTemplateHtml = (contentHtml, values) => {
    const result = { html: '', missing: [], hasExamples: false, error: null };
    if (!contentHtml) return result;
    try {
        const doc = parseHtmlDocument(contentHtml);
        const body = doc.body;
        const missing = new Map();
        const noteEntry = (id, label, entry) => {
            if (!entry) missing.set(id || label, label);
            else if (entry.example) result.hasExamples = true;
        };

        stripDuplicateSalutations(body);

        Array.from(body.querySelectorAll('span[data-type="mention"]')).forEach(chip => {
            if (!chip.isConnected) return;
            const id = chip.getAttribute('data-id') || '';
            const label = variableLabel(id, chip.getAttribute('data-label'));
            const entry = lookupVariable(values, id);
            noteEntry(id, label, entry);
            if (entry && typeof entry.html === 'string') {
                placeBlockElement(chip, createBlockElement(doc, entry));
            } else {
                const span = doc.createElement('span');
                span.className = 'tpl-var';
                renderVariableInto(doc, span, entry, label, { markExamples: true });
                chip.replaceWith(span);
            }
        });

        // Text-Platzhalter in geschweiften Klammern, z.B. {mieter_name}
        const blocks = [];
        forEachTextNode(body, (node) => {
            const text = node.nodeValue;
            if (!text || text.indexOf('{') === -1 || !node.parentNode) return;
            const fragment = doc.createDocumentFragment();
            let last = 0;
            let replaced = false;
            let match;
            BRACE_PLACEHOLDER_RE.lastIndex = 0;
            while ((match = BRACE_PLACEHOLDER_RE.exec(text)) !== null) {
                const id = match[1];
                if (!isKnownVariableId(id)) continue;
                replaced = true;
                if (match.index > last) fragment.appendChild(doc.createTextNode(text.slice(last, match.index)));
                const label = variableLabel(id);
                const entry = lookupVariable(values, id);
                noteEntry(id, label, entry);
                const span = doc.createElement('span');
                span.className = 'tpl-var';
                if (entry && typeof entry.html === 'string') blocks.push({ marker: span, entry });
                else renderVariableInto(doc, span, entry, label, { markExamples: true });
                fragment.appendChild(span);
                last = match.index + match[0].length;
            }
            if (!replaced) return;
            if (last < text.length) fragment.appendChild(doc.createTextNode(text.slice(last)));
            node.parentNode.replaceChild(fragment, node);
        });
        blocks.forEach(({ marker, entry }) => placeBlockElement(marker, createBlockElement(doc, entry)));

        sanitizeDom(body);
        result.html = body.innerHTML;
        result.missing = Array.from(missing.values());
    } catch (err) {
        console.error('Platzhalter konnten nicht aufgelöst werden:', err);
        result.error = err?.message || String(err);
        result.html = '<div class="letter-page"><div class="letter-body"><p>Die Vorschau konnte nicht erzeugt werden.</p></div></div>';
    }
    return result;
};

// Bereinigt bereits gespeicherte Vorlagen beim Laden (gleiche Regeln wie die SQL-Bereinigung
// _fixwork/sql/101200_templates_cleanup.sql). Rückgabe: neues HTML + Liste der Änderungen.
// Beispielwerte, die frühere Editor-Versionen in die Platzhalter geschrieben und mitgespeichert haben
const LEGACY_EXAMPLE_TEXTS = new Set([
    'Max Mustermann', 'Mustermann', 'Sehr geehrter Herr Mustermann', 'Dr. Sabine Sommer',
    'Wohnpark Sonnenseite', 'Wohnung EG links', 'Musterstraße 42, 12345 Musterstadt',
    'ImmoControlpro Vermieter GmbH', 'info@vermieter.de', '0123 4567890', '123/456/78901', 'DE123456789',
    '908,70 €', '17.06.2026', '14', '2', '3,70 €', '2025', '01.01.2025 - 31.12.2025', '550,00 €', '400,00 €',
    '150,00 €', 'Nachzahlung', '1.950,00 €', '15.05.2026 - 22.05.2026', 'RE-2026-0412', '03.06.2026',
    '560,75 €', '39,25 €', '600,00 €', 'RE-2026-0399', 'ST-2026-0001', '650,00 €', '715,00 €', '65,00 €',
    '01.08.2026', '31.07.2026', '01.06.2026'
]);
const FOREIGN_CONTACT_RE = /(?:E-Mail:\s*)?info@immocontrol\.de/g;
const ORT_DEN_BEFORE_DATE_RE = /Ort,\s*den\s*$/;
const normalizeStoredTemplateHtml = (html) => {
    const changes = [];
    if (typeof html !== 'string' || !html || typeof window === 'undefined' || !window.DOMParser) {
        return { html: html || '', changes };
    }
    try {
        const doc = parseHtmlDocument(html);
        const body = doc.body;

        let exampleValuesRemoved = false;
        body.querySelectorAll('span[data-type="mention"]').forEach(chip => {
            const label = variableLabel(chip.getAttribute('data-id'), chip.getAttribute('data-label'));
            const text = chip.textContent || '';
            const hasExampleContent = chip.children.length > 0 || /\n/.test(text) || LEGACY_EXAMPLE_TEXTS.has(text.trim());
            if (hasExampleContent && text !== label) {
                chip.textContent = label;
                exampleValuesRemoved = true;
            }
        });
        if (exampleValuesRemoved) changes.push('mitgespeicherte Beispielwerte aus den Platzhaltern entfernt');

        if (stripDuplicateSalutations(body)) changes.push('doppelte Anrede („Sehr geehrte/r“ vor der Variable „Briefanrede“) entfernt');

        let ortRemoved = false;
        body.querySelectorAll('span[data-type="mention"][data-id="rechnungsdatum"]').forEach(chip => {
            const prev = chip.previousSibling;
            if (prev && prev.nodeType === 3 && ORT_DEN_BEFORE_DATE_RE.test(prev.nodeValue)) {
                prev.nodeValue = prev.nodeValue.replace(ORT_DEN_BEFORE_DATE_RE, '');
                ortRemoved = true;
            }
        });
        if (ortRemoved) changes.push('Platzhaltertext „Ort, den“ vor dem Briefdatum entfernt');

        let foreignMailReplaced = false;
        forEachTextNode(body, (node) => {
            const text = node.nodeValue;
            if (!text || text.indexOf('info@immocontrol.de') === -1 || !node.parentNode) return;
            const fragment = doc.createDocumentFragment();
            let last = 0;
            let match;
            FOREIGN_CONTACT_RE.lastIndex = 0;
            while ((match = FOREIGN_CONTACT_RE.exec(text)) !== null) {
                if (match.index > last) fragment.appendChild(doc.createTextNode(text.slice(last, match.index)));
                fragment.appendChild(createNeutralChip(doc, 'vermieter_kontakt'));
                last = match.index + match[0].length;
            }
            if (last < text.length) fragment.appendChild(doc.createTextNode(text.slice(last)));
            node.parentNode.replaceChild(fragment, node);
            foreignMailReplaced = true;
        });
        if (foreignMailReplaced) changes.push('fest eingetragene fremde E-Mail-Adresse durch den Platzhalter „Vermieter Kontakt“ ersetzt');

        let typoFixed = false;
        forEachTextNode(body, (node) => {
            if (node.nodeValue && node.nodeValue.indexOf('Die Miete is nach') !== -1) {
                node.nodeValue = node.nodeValue.split('Die Miete is nach').join('Die Miete ist nach');
                typoFixed = true;
            }
        });
        if (typoFixed) changes.push('Tippfehler „Die Miete is nach“ korrigiert');

        return { html: changes.length > 0 ? body.innerHTML : html, changes };
    } catch (err) {
        console.error('Vorlage konnte nicht bereinigt werden:', err);
        return { html, changes: [] };
    }
};

// Absatz-/Überschriften-Formatierung der Vorlagen (z.B. Schriftgröße, Abstände) im Schema
// behalten – nur unbedenkliche Eigenschaften (text-align verwaltet TextAlign).
const ALLOWED_BLOCK_STYLE_PROPS = new Set(['font-size', 'font-weight', 'font-style', 'margin-top', 'margin-bottom', 'padding-top', 'padding-bottom', 'border-top', 'border-bottom', 'color', 'line-height']);
const sanitizeBlockStyle = (styleStr) => {
    if (!styleStr) return null;
    const kept = [];
    String(styleStr).split(';').forEach(rule => {
        const idx = rule.indexOf(':');
        if (idx < 0) return;
        const prop = rule.slice(0, idx).trim().toLowerCase();
        const value = rule.slice(idx + 1).trim();
        if (!value || !ALLOWED_BLOCK_STYLE_PROPS.has(prop)) return;
        if (/url\s*\(|expression|javascript:|[<>{}"]/i.test(value)) return;
        kept.push(`${prop}: ${value}`);
    });
    return kept.length > 0 ? kept.join('; ') : null;
};

const BlockStyle = Extension.create({
    name: 'blockStyle',
    addGlobalAttributes() {
        return [{
            types: ['paragraph', 'heading'],
            attributes: {
                blockStyle: {
                    default: null,
                    parseHTML: element => sanitizeBlockStyle(element.getAttribute('style')),
                    renderHTML: attributes => (attributes.blockStyle ? { style: attributes.blockStyle } : {})
                }
            }
        }];
    }
});

// Eingefügter Fremd-Text (z.B. aus Word) behält nur die Ausrichtung, keine Inline-Formatierung.
const stripPastedBlockStyles = (html) => {
    if (!html || typeof window === 'undefined' || !window.DOMParser) return html;
    try {
        const doc = parseHtmlDocument(html);
        doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6').forEach(el => {
            const align = el.style && el.style.textAlign;
            if (align) el.setAttribute('style', `text-align: ${align}`);
            else el.removeAttribute('style');
        });
        return doc.body.innerHTML;
    } catch {
        return html;
    }
};

// Bilder: nur Rasterformate (kein SVG), große Bilder vor dem Einbetten verkleinern.
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_EMBED_CHARS = 1.5 * 1024 * 1024;
const MAX_IMAGE_EDGE_PX = 1600;

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
});

const downscaleImageDataUrl = (dataUrl, mimeType) => new Promise((resolve) => {
    // Hinweis: "Image" ist hier die TipTap-Erweiterung, daher createElement('img')
    const img = document.createElement('img');
    img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_EDGE_PX / (img.naturalWidth || 1), MAX_IMAGE_EDGE_PX / (img.naturalHeight || 1));
        if (scale >= 1 && dataUrl.length <= 400 * 1024) { resolve(dataUrl); return; }
        try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            const outType = mimeType === 'image/jpeg' || mimeType === 'image/webp' ? mimeType : 'image/png';
            const out = canvas.toDataURL(outType, 0.85);
            resolve(out && out.length < dataUrl.length ? out : dataUrl);
        } catch {
            resolve(dataUrl);
        }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
});

const prepareImageForEmbedding = async (file) => {
    if (!file) return null;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        alert('Bitte ein Bild im Format PNG, JPEG, WebP oder GIF verwenden.');
        return null;
    }
    if (file.size > MAX_IMAGE_INPUT_BYTES) {
        alert('Das Bild darf maximal 2 MB groß sein.');
        return null;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const prepared = await downscaleImageDataUrl(dataUrl, file.type);
    if (!SAFE_DATA_IMAGE_RE.test(prepared)) return null;
    if (prepared.length > MAX_IMAGE_EMBED_CHARS) {
        alert('Das Bild ist auch nach dem Verkleinern noch zu groß. Bitte ein kleineres Bild verwenden.');
        return null;
    }
    return prepared;
};

// ── Gemeinsame Inhalts-Stile (Editor, Live-Vorschau UND Druckfenster) ────────────────────
// Eine Quelle für Listen, Tabellen und Markierungen – verhindert neue Abweichungen zwischen
// Editor und Druck (das Druckfenster lädt index.css nicht).
const LETTER_CONTENT_CSS = `
    .letter-page ul, .letter-page ol { padding-left: 1.5em; margin: 0 0 1em 0; }
    .letter-page ul { list-style-type: disc; }
    .letter-page ol { list-style-type: decimal; }
    .letter-page li > p { margin-bottom: 0.25em !important; min-height: 0 !important; }
    .letter-page img.editor-image { max-width: 100%; }
    .letter-page table:not(.invoice-table) { width: 100%; border-collapse: collapse; margin: 15px 0; background-color: transparent !important; border: 1px solid #cbd5e1 !important; }
    .letter-page table:not(.invoice-table) th { background-color: #f1f5f9 !important; color: #0f172a !important; font-weight: bold; border: 1px solid #cbd5e1 !important; padding: 8px 12px !important; }
    .letter-page table:not(.invoice-table) td { border: 1px solid #cbd5e1 !important; padding: 8px 12px !important; color: #334155 !important; background-color: transparent !important; }
    .letter-page .invoice-table { width: 100%; border-collapse: collapse; margin-bottom: 8mm; background-color: transparent !important; border: none !important; }
    .letter-page .invoice-table th { border-bottom: 2px solid #000 !important; border-top: none !important; border-left: none !important; border-right: none !important; text-align: left; padding: 8px 0 !important; font-weight: 700; background-color: transparent !important; color: #000000 !important; }
    .letter-page .invoice-table td { border-bottom: 1px solid #ddd !important; border-top: none !important; border-left: none !important; border-right: none !important; padding: 8px 0 !important; color: #000000 !important; background-color: transparent !important; }
    .letter-page .totals { display: flex; justify-content: flex-end; margin-bottom: 20mm; }
    .letter-page .totals-box { width: 80mm; }
    .letter-page .t-row { display: flex; justify-content: space-between; margin-bottom: 4px; color: #000000; }
    .letter-page .t-row.final { border-top: 2px solid #000; padding-top: 4px; margin-top: 4px; font-weight: 700; font-size: 11pt; color: #000000; }
    .letter-page .tpl-block { margin: 0 0 1em 0; }
    .letter-page .tpl-example-block { outline: 1px dashed #ca8a04; outline-offset: 2px; }
    .letter-page .tpl-missing { color: #b91c1c !important; background-color: #fee2e2 !important; font-weight: 600; border-radius: 2px; }
    .letter-page .tpl-example { background-color: #fef9c3; border-bottom: 1px dotted #ca8a04; }
`;

// Seiten-Stile des Druckfensters (A4, DIN 5008)
const PRINT_PAGE_CSS = `
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
        /* Keine feste Höhe/overflow auf html/body: sonst schneiden manche Browser nach Seite 1 ab.
           Die Seitenbegrenzung leisten .letter-page und die page-break-Regeln. */
        html, body {
            margin: 0 !important;
            padding: 0 !important;
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
        .letter-page:last-child,
        .letter-page:last-of-type {
            page-break-after: avoid !important;
        }
        /* Der Editor (TipTap TrailingNode) hängt hinter der letzten Seite einen leeren Absatz an;
           ohne diese Regel entstünde im Druck ein zusätzliches leeres Blatt. */
        .preview-content > p:empty {
            display: none !important;
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
    .tpl-toolbar { text-align: center; padding: 12px 0 20px; max-width: 210mm; margin: 0 auto; }
    .tpl-toolbar button { padding: 10px 28px; font-size: 14px; font-weight: 600; background: #0ea5e9; color: white; border: none; border-radius: 8px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .tpl-toolbar p { margin-top: 8px; font-size: 12px; color: #64748b; }
    .tpl-notice { margin-top: 10px; padding: 10px 14px; border-radius: 8px; font-size: 13px; line-height: 1.45; text-align: left; }
    .tpl-notice[hidden] { display: none !important; }
    .tpl-notice-info { background: #fef9c3; border: 1px solid #fde047; color: #713f12; }
    .tpl-notice-warning { background: #fee2e2; border: 1px solid #fca5a5; color: #7f1d1d; }

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

    /* Der Editor (ProseMirror) zeigt manuelle Zeilenumbrüche (literale \\n) via
       white-space:pre-wrap an. Das Druckfenster nutzt sonst white-space:normal und
       zieht sie auf eine Zeile zusammen. Hier für die DIN-5008-Textfelder angleichen –
       Tabellen bewusst ausgenommen. */
    .letter-sender,
    .letter-recipient,
    .letter-date,
    .letter-subject,
    .letter-object,
    .letter-footer,
    .footer-col {
        white-space: pre-wrap;
    }
`;

const createPrintNonce = () => {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

// Druckfenster: eigenes Dokument (Blob-URL) mit Content-Security-Policy. Fremdes Skript kann
// dort nicht laufen (nur das Skript mit Einmal-Nonce), das Fenster erhält keinen Zugriff auf
// die App (opener wird getrennt). Der Druck startet erst nach Schrift und Bildern.
const openPrintWindow = ({ bodyHtml, title, notices = [] }) => {
    const nonce = createPrintNonce();
    const noticeHtml = notices
        .filter(n => n && n.text)
        .map(n => `<div class="tpl-notice tpl-notice-${n.type === 'warning' ? 'warning' : 'info'}">${escapeHtml(n.text)}</div>`)
        .join('');
    const csp = [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        "style-src 'unsafe-inline'",
        `font-src ${fontOrigin()} data:`,
        'img-src data: blob: https:',
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
        "frame-src 'none'",
        "connect-src 'none'"
    ].join('; ');
    const html = `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="referrer" content="no-referrer">
    <title>${escapeHtml(title)}</title>
    <style>${openSansFontFaceCss()}${PRINT_PAGE_CSS}${LETTER_CONTENT_CSS}</style>
</head>
<body>
    <div class="no-print tpl-toolbar">
        <button id="tpl-print-btn" type="button">🖨️ Als PDF drucken / speichern</button>
        <p>Drücke Strg+P oder klicke den Button. Wähle "Als PDF speichern" im Druckdialog.</p>
        ${noticeHtml}
        <div id="tpl-overflow-warning" class="tpl-notice tpl-notice-warning" hidden></div>
    </div>
    <div class="preview-content">${bodyHtml}</div>
    <script nonce="${nonce}">
    (function () {
        var btn = document.getElementById('tpl-print-btn');
        if (btn) btn.addEventListener('click', function () { window.print(); });
        function whenLoaded() {
            return new Promise(function (resolve) {
                if (document.readyState === 'complete') resolve();
                else window.addEventListener('load', function () { resolve(); }, { once: true });
            });
        }
        function fontsReady() {
            return (document.fonts && document.fonts.ready) ? document.fonts.ready.catch(function () {}) : Promise.resolve();
        }
        function checkOverflow() {
            var pages = document.querySelectorAll('.preview-content > .letter-page');
            var hit = [];
            Array.prototype.forEach.call(pages, function (page, idx) {
                var body = page.querySelector('.letter-body');
                if (body && body.scrollHeight > body.clientHeight + 1) hit.push(idx + 1);
            });
            var box = document.getElementById('tpl-overflow-warning');
            if (box && hit.length) {
                box.textContent = 'Achtung: Auf Seite ' + hit.join(', ') + ' ist der Inhalt länger als der Textbereich und würde im Druck abgeschnitten. Bitte die Vorlage im Editor kürzen oder auf eine weitere Seite verteilen. Der Druckdialog wurde deshalb nicht automatisch geöffnet.';
                box.hidden = false;
            }
            return hit.length;
        }
        var limit = new Promise(function (resolve) { setTimeout(resolve, 5000); });
        Promise.race([whenLoaded().then(fontsReady), limit]).then(function () {
            if (!checkOverflow()) setTimeout(function () { window.print(); }, 50);
        });
    })();
    </script>
</body>
</html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const win = window.open(url, '_blank');
    if (!win) {
        URL.revokeObjectURL(url);
        alert('Das Vorschaufenster wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben und erneut versuchen.');
        return false;
    }
    try { win.opener = null; } catch { /* Fenster bereits getrennt */ }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
};

const collectUsedVariables = (doc) => {
    const used = new Map();
    if (!doc) return used;
    doc.descendants((node) => {
        if (node.type.name === 'mention' && node.attrs.id && !used.has(node.attrs.id)) {
            used.set(node.attrs.id, variableLabel(node.attrs.id, node.attrs.label));
        } else if (node.isText && node.text && node.text.indexOf('{') !== -1) {
            BRACE_PLACEHOLDER_RE.lastIndex = 0;
            let match;
            while ((match = BRACE_PLACEHOLDER_RE.exec(node.text)) !== null) {
                if (isKnownVariableId(match[1]) && !used.has(match[1])) used.set(match[1], variableLabel(match[1]));
            }
        }
    });
    return used;
};

const TEMPLATE_HINTS = {
    rent_increase: 'Mieterhöhung: Bitte neue Miete, Erhöhungsbetrag, Wirksamkeitsdatum und Zustimmungsfrist selbst eintragen, die Begründung nach § 558a BGB ergänzen und Wartefrist sowie Kappungsgrenze (§ 558 BGB) vor dem Versand prüfen.',
    rent_increase_consent: 'Bitte die Werte der Mieterhöhung selbst eintragen – sie werden nicht automatisch berechnet.',
    rent_clearance_certificate: 'Bitte vor dem Ausstellen den aktuellen Mietkontostand des Mieters prüfen. Die Bescheinigung bestätigt Schuldenfreiheit; es wird kein Saldo automatisch geprüft.'
};

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
    const userId = user?.id || null;
    const { portfolios } = usePortfolio();
    const location = useLocation();

    // Echtdaten-Modus: "Dokument erstellen" beim Mieter übergibt dessen Daten per Router-State
    const tenantState = location.state?.tenant || null;
    const isRealMode = !!tenantState;

    // Portfolio: im Echtdaten-Modus das Portfolio des Mieters vorbelegen (falls übergeben bzw.
    // eindeutig), damit Vermieter-/Bankdaten nicht fehlen. Eine manuelle Auswahl hat Vorrang.
    const [selectedPortfolioId, setSelectedPortfolioId] = useState(() => tenantState?.portfolio_id || 'global');
    const [portfolioTouched, setPortfolioTouched] = useState(false);
    const portfolioList = portfolios || [];
    const effectivePortfolioId = (isRealMode && !portfolioTouched && selectedPortfolioId === 'global' && portfolioList.length === 1)
        ? portfolioList[0].id
        : selectedPortfolioId;
    const activePortfolio = portfolioList.find(p => p.id === effectivePortfolioId) || null;
    // Portfolio-Vorlagen darf nur der Portfolio-Eigentümer ändern (Mitnutzer: nur lesen)
    const canWriteTemplates = effectivePortfolioId === 'global' || !activePortfolio?.user_id || activePortfolio.user_id === userId;

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
    const [editorTick, setEditorTick] = useState(0);
    const [diagnostics, setDiagnostics] = useState({
        lastError: null,
        loadSource: 'Initial',
        dbDataFound: false,
        contentLength: 0
    });
    // Ungespeicherte Änderungen (Pagination und Laden zählen nicht)
    const [isDirty, setIsDirty] = useState(false);
    // Ladefehler: Speichern gesperrt, damit die gespeicherte Fassung nicht überschrieben wird
    const [loadError, setLoadError] = useState(null);
    // Beim Laden automatisch bereinigte Punkte (Hinweis an den Nutzer)
    const [loadNotice, setLoadNotice] = useState(null);
    // Seiten, deren Inhalt nicht auf die Seite passt (würde im Druck abgeschnitten)
    const [overflowPages, setOverflowPages] = useState([]);
    // Im Echtdaten-Modus vom Nutzer eingetragene Angaben (nur für dieses Dokument, je Mieter)
    const tenantKey = tenantState
        ? [tenantState.lease_id, tenantState.first_name, tenantState.last_name, tenantState.einheit_name, tenantState.start_date].join('|')
        : '';
    const [manualState, setManualState] = useState({ tenantKey: '', values: {} });
    const manualValues = manualState.tenantKey === tenantKey ? manualState.values : EMPTY_MANUAL_VALUES;
    const updateManualValue = (id, value) => {
        setManualState(prev => ({
            tenantKey,
            values: { ...(prev.tenantKey === tenantKey ? prev.values : {}), [id]: value }
        }));
    };
    // Warnung vor dem Druck (fehlende Angaben)
    const [printWarning, setPrintWarning] = useState(null);
    const [creating, setCreating] = useState(false);
    const [dates] = useState(getDateStrings);

    // Custom template list from DB
    const [customTemplates, setCustomTemplates] = useState([]);

    // Modals
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newTemplateName, setNewTemplateName] = useState('');
    const [newTemplateCategory, setNewTemplateCategory] = useState('Eigene');
    const [newTemplateSubject, setNewTemplateSubject] = useState('');

    // Werte für die Platzhalter-Anzeige im Editor (NodeViews lesen sie außerhalb des Renderns)
    const chipValuesRef = useRef(null);
    const chipViewsRef = useRef(new Set());
    const loadSeqRef = useRef(0);
    const tickPendingRef = useRef(false);
    const previewContainerRef = useRef(null);

    // TipTap Editor initialization
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                horizontalRule: false,
            }),
            BlockStyle,
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
                // Gespeichert wird NUR die Kennung und die Bezeichnung – nie Beispielwerte.
                renderHTML({ node }) {
                    const id = node.attrs.id;
                    const label = variableLabel(id, node.attrs.label);
                    return [
                        'span',
                        { class: 'variable-chip', 'data-type': 'mention', 'data-id': id, 'data-label': label },
                        label
                    ];
                },
                renderText({ node }) {
                    return `{${node.attrs.id}}`;
                },
                // Anzeige im Editor: derselbe Wert wie in Vorschau und Druck (Beispiel- bzw. Echtdaten,
                // fehlende Angaben rot markiert). Die Werte kommen aus chipValuesRef.
                addNodeView() {
                    return ({ node: initialNode }) => {
                        let currentNode = initialNode;
                        const dom = document.createElement('span');
                        const render = () => {
                            const id = currentNode.attrs.id || '';
                            const label = variableLabel(id, currentNode.attrs.label);
                            const entry = lookupVariable(chipValuesRef.current, id);
                            const isBlock = !!(entry && typeof entry.html === 'string');
                            dom.className = isBlock ? 'variable-chip expanded-variable-table' : 'variable-chip';
                            dom.setAttribute('data-type', 'mention');
                            dom.setAttribute('data-id', id);
                            dom.setAttribute('data-label', label);
                            dom.setAttribute('contenteditable', 'false');
                            dom.title = entry
                                ? `Platzhalter: ${label}${entry.example ? ' (Beispielwert)' : ''}`
                                : `Platzhalter: ${label} – Angabe fehlt`;
                            renderVariableInto(document, dom, entry, label);
                        };
                        render();
                        chipViewsRef.current.add(render);
                        return {
                            dom,
                            update: (updatedNode) => {
                                if (updatedNode.type !== currentNode.type) return false;
                                currentNode = updatedNode;
                                render();
                                return true;
                            },
                            destroy: () => { chipViewsRef.current.delete(render); },
                            ignoreMutation: (mutation) => mutation.type !== 'selection'
                        };
                    };
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
                // Bilder (Logo, Unterschrift) werden als Data-URL eingebettet – ohne allowBase64
                // verwirft TipTap sie beim nächsten Laden und das Speichern löscht sie endgültig.
                allowBase64: true,
                HTMLAttributes: {
                    class: 'editor-image',
                    style: 'max-height: 240px; object-fit: contain; margin: 10px 0; display: block;'
                }
            })
        ],
        content: '',
        onUpdate({ editor, transaction }) {
            let count = 0;
            editor.state.doc.forEach(node => {
                if (node.type.name === 'letterPage') {
                    count++;
                }
            });
            setPageCount(count > 0 ? count : 1);
            // Nur echte Bearbeitungen zählen als ungespeicherte Änderung
            if (!transaction?.getMeta(PAGINATION_META) && !transaction?.getMeta(TEMPLATE_LOAD_META)) {
                setIsDirty(true);
            }
            // Re-Render höchstens einmal pro Frame (Toolbar-Status, Vorschau, fehlende Angaben)
            if (!tickPendingRef.current) {
                tickPendingRef.current = true;
                requestAnimationFrame(() => {
                    tickPendingRef.current = false;
                    setEditorTick(prev => prev + 1);
                });
            }
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
            // Eingefügter Fremd-Text (z.B. aus Word) übernimmt keine Absatz-Inline-Stile
            transformPastedHTML(html) {
                return stripPastedBlockStyles(html);
            },
            handleDrop(view, event, slice, moved) {
                if (!moved && event.dataTransfer) {
                    const files = event.dataTransfer.files;
                    if (files && files.length > 0) {
                        const file = files[0];
                        if (file.type.startsWith('image/')) {
                            const dropCoordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
                            prepareImageForEmbedding(file)
                                .then((src) => {
                                    if (!src || !dropCoordinates) return;
                                    const { schema } = view.state;
                                    const node = schema.nodes.image.create({ src });
                                    const pos = Math.min(dropCoordinates.pos, view.state.doc.content.size);
                                    view.dispatch(view.state.tr.insert(pos, node));
                                })
                                .catch((err) => alert(err?.message || 'Das Bild konnte nicht eingefügt werden.'));
                            return true;
                        }
                    }
                    // Platzhalter aus der Palette: eigener MIME-Typ; Kennung wird gegen die
                    // bekannten Variablen geprüft, die Bezeichnung kommt aus der Palette.
                    const data = event.dataTransfer.getData(VARIABLE_DRAG_MIME) || event.dataTransfer.getData('text/plain');
                    try {
                        const json = JSON.parse(data);
                        if (json && json.type === 'mention' && isKnownVariableId(json.id)) {
                            const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
                            if (coordinates) {
                                const { schema } = view.state;
                                const node = schema.nodes.mention.create({ id: json.id, label: variableLabel(json.id) });
                                const transaction = view.state.tr.insert(coordinates.pos, node);
                                view.dispatch(transaction);
                                return true;
                            }
                        }
                    } catch {
                        // kein Platzhalter – normales Drop-Verhalten
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
            // nur am ersten ':' trennen (Werte wie url(data:…) enthalten weitere Doppelpunkte)
            const idx = rule.indexOf(':');
            if (idx < 0) return;
            const p = rule.slice(0, idx).trim();
            const v = rule.slice(idx + 1).trim();
            if (p && v) r[p] = v;
        });
        return r;
    };
    const buildStyleStr = (obj) => Object.entries(obj)
        .filter(([, v]) => v && v !== '0mm')
        .map(([k, v]) => `${k}: ${v}`).join('; ') || null;

    const LAYOUT_PROP_KEYS = { 'margin-top': 'marginTop', 'margin-bottom': 'marginBottom', height: 'height', width: 'width' };

    // Setzt mehrere Abstands-/Größenwerte in EINER Transaktion (ein Undo-Schritt)
    const updateLayoutStyles = (changes) => {
        if (!layoutPopover || layoutPopover.nodePos < 0 || !editor) return;
        const node = editor.state.doc.nodeAt(layoutPopover.nodePos);
        if (!node) return;
        const styles = parseStyleStr(node.attrs.style);
        Object.entries(changes).forEach(([property, value]) => {
            if (value > 0) styles[property] = `${value}mm`;
            else delete styles[property];
        });
        const tr = editor.state.tr.setNodeMarkup(layoutPopover.nodePos, null, {
            ...node.attrs, style: buildStyleStr(styles)
        });
        editor.view.dispatch(tr);
        setLayoutPopover(prev => {
            if (!prev) return prev;
            const nextStyles = { ...prev.styles };
            Object.entries(changes).forEach(([property, value]) => { nextStyles[LAYOUT_PROP_KEYS[property] || property] = value; });
            return { ...prev, styles: nextStyles };
        });
    };
    const updateLayoutStyle = (property, value) => updateLayoutStyles({ [property]: value });

    const canMoveNode = (pos, direction) => {
        if (!editor) return false;
        try {
            const $pos = editor.state.doc.resolve(pos);
            const parent = $pos.parent;
            if (parent.type.name !== 'letterPage') return false;
            const index = $pos.index();
            const targetIndex = index + direction;
            return targetIndex >= 0 && targetIndex < parent.childCount;
        } catch {
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
            
            let html = '';
            if (secClass === 'letter-sender') {
                html = `<div class="letter-sender">Absenderzeile (Bitte anpassen)</div>`;
            } else if (secClass === 'letter-header-row') {
                html = `<div class="letter-header-row"><div class="letter-recipient">Empfängeradresse</div><div class="letter-date"><span data-type="mention" data-id="rechnungsdatum" data-label="Briefdatum">Briefdatum</span></div></div>`;
            } else if (secClass === 'letter-subject') {
                html = `<div class="letter-subject">Betreffzeile (Bitte anpassen)</div>`;
            } else if (secClass === 'letter-object') {
                html = `<div class="letter-object">Betreffdetails / Objekt</div>`;
            } else if (secClass === 'letter-body') {
                html = `<div class="letter-body"><p>Brieftext...</p></div>`;
            } else if (secClass === 'letter-footer') {
                html = `<div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br><span data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span></div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div>`;
            }
            
            if (!html) return;
            
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            
            // Parse DOM using ProseMirror DOMParser
            const parsed = PMDOMParser.fromSchema(state.schema).parse(tempDiv);
            const node = parsed.firstChild;
            if (!node) return;
            
            const tr = state.tr;
            
            let pagePos = -1;
            state.doc.descendants((n, p) => {
                if (n.type.name === 'letterPage') {
                    if (pagePos === -1) {
                        pagePos = p;
                    }
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
    // Maßstab der Seite (CSS-zoom bei kleineren Bildschirmen): Rects sind skaliert, CSS-Längen nicht
    const A4_WIDTH_PX = 210 * 96 / 25.4;
    const getPageScale = (domPage) => {
        const width = domPage ? domPage.getBoundingClientRect().width : 0;
        return width > 0 ? width / A4_WIDTH_PX : 1;
    };
    // Passt "childEl" (inkl. Außenabständen) noch unter den letzten Inhalt von "domBody"?
    // Alle Werte in derselben (skalierten) Einheit, mit kleiner Hysterese gegen Pendeln.
    const fitsIntoBody = (domBody, childEl, scale) => {
        const childRect = childEl.getBoundingClientRect();
        if (!(childRect.height > 0)) return false;
        const childStyle = window.getComputedStyle(childEl);
        const childNeed = childRect.height + ((parseFloat(childStyle.marginTop) || 0) + (parseFloat(childStyle.marginBottom) || 0)) * scale;
        const bodyRect = domBody.getBoundingClientRect();
        const lastChild = domBody.lastElementChild;
        let contentBottom = bodyRect.top;
        if (lastChild) {
            const lastStyle = window.getComputedStyle(lastChild);
            contentBottom = lastChild.getBoundingClientRect().bottom + (parseFloat(lastStyle.marginBottom) || 0) * scale;
        }
        const freeSpace = bodyRect.top + domBody.clientHeight * scale - contentBottom;
        return childNeed + 4 * scale <= freeSpace;
    };

    const runPaginationStep = (editor) => {
        if (!editor || !editor.view || !editor.view.dom) return false;

        // DOM synchronisieren damit Messungen korrekt sind
        try { editor.view.updateState(editor.view.state); } catch { /* ignore */ }

        // Seitenumbruch-Transaktionen: nicht in der Undo-Historie, keine "ungespeicherte Änderung"
        const dispatchLayout = (tr) => {
            tr.setMeta('addToHistory', false);
            tr.setMeta(PAGINATION_META, true);
            editor.view.dispatch(tr);
        };

        const doc = editor.state.doc;
        const pages = getPagesFromDoc(doc);
        // Nur die Seiten DIESES Editors (nicht global im Dokument suchen)
        const domPages = editor.view.dom.querySelectorAll(':scope > .letter-page');

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
                                { blockStyle: sanitizeBlockStyle(styleStr) },
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
                        dispatchLayout(tr);
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
                        dispatchLayout(tr);
                        return true;
                    } else {
                        // Nächste Seite existiert → AM ANFANG des Bodys der nächsten Seite einfügen
                        // So bleibt der Text immer sauber innerhalb des Body-Elements gefangen
                        const nextPage = pages[nextIdx];
                        const tr = editor.state.tr;
                        const targetPos = nextPage.bodyPos !== -1 ? nextPage.bodyPos + 1 : nextPage.pos + 1;

                        tr.insert(targetPos, lastChild.copy(lastChild.content));
                        tr.delete(lastChildStart, lastChildEnd);
                        dispatchLayout(tr);
                        return true;
                    }
                } catch (e) {
                    console.error('Pagination overflow error:', e);
                }
            }

            // Overflow mit nur einem Kind → kann nicht weiter aufgeteilt werden (wird gemeldet)
            if (isOverflowing && page.bodyNode && page.bodyNode.childCount <= 1) continue;

            const pageScale = getPageScale(domPage);

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
                        if (fitsIntoBody(domBody, firstDomChild, pageScale)) {
                            try {
                                const fcStart = nextPage.pos + 1;
                                const fcEnd = fcStart + firstPageChild.nodeSize;
                                const tr = editor.state.tr;
                                tr.insert(page.bodyEnd - 1, firstPageChild.copy(firstPageChild.content));
                                tr.delete(tr.mapping.map(fcStart), tr.mapping.map(fcEnd));
                                dispatchLayout(tr);
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
                        if (fitsIntoBody(domBody, firstChildDom, pageScale)) {
                            try {
                                const firstChild = nextPage.bodyNode.firstChild;
                                const fcStart = nextPage.bodyPos + 1;
                                const fcEnd = fcStart + firstChild.nodeSize;
                                const tr = editor.state.tr;
                                tr.insert(page.bodyEnd - 1, firstChild.copy(firstChild.content));
                                tr.delete(tr.mapping.map(fcStart), tr.mapping.map(fcEnd));
                                dispatchLayout(tr);
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
                            dispatchLayout(editor.state.tr.delete(nextPage.pos, nextPage.end));
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

    // Seiten, deren Body überläuft und nicht weiter aufgeteilt werden kann (würde abgeschnitten)
    const detectOverflowPages = (editor) => {
        const domPages = editor.view.dom.querySelectorAll(':scope > .letter-page');
        const hit = [];
        domPages.forEach((domPage, idx) => {
            const domBody = domPage.querySelector('.letter-body');
            if (domBody && domBody.scrollHeight > domBody.clientHeight + 1) hit.push(idx + 1);
        });
        setOverflowPages(prev => (prev.length === hit.length && prev.every((v, i) => v === hit[i]) ? prev : hit));
    };

    // Führt die Pagination in einer Schleife aus bis keine Änderung mehr nötig ist.
    // Zeitbudget je Frame; lange Dokumente werden in Folge-Frames fertig umbrochen.
    const runFullPagination = (editor, round = 0) => {
        if (!editor?.view?.dom) return;
        let changed = true;
        let iterations = 0;
        const startedAt = performance.now();
        const MAX_ITERATIONS = 400; // Schutz gegen Endlosschleifen
        while (changed && iterations < MAX_ITERATIONS && performance.now() - startedAt < 120) {
            changed = runPaginationStep(editor);
            iterations++;
        }
        if (changed && round < 8) {
            requestAnimationFrame(() => runFullPagination(editor, round + 1));
            return;
        }
        // Page-Count aktualisieren
        let count = 0;
        editor.state.doc.forEach(node => {
            if (node.type.name === 'letterPage') count++;
        });
        setPageCount(count > 0 ? count : 1);
        detectOverflowPages(editor);
    };

    // Scroll corresponding page into view
    const scrollToPage = (pageNumber) => {
        setPreviewPage(pageNumber);
        const container = showLivePreview ? previewContainerRef.current : editor?.view?.dom;
        const domPages = container ? container.querySelectorAll(':scope > .letter-page') : [];
        if (domPages && domPages[pageNumber - 1]) {
            domPages[pageNumber - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    // Pagination side-effect hooks
    useEffect(() => {
        if (!editor || loading) return;

        let timeoutId = null;
        let rafId = null;
        let cancelled = false;

        const handlePagination = () => {
            runFullPagination(editor);
        };

        // Nur bei Inhaltsänderungen (nicht bei jeder Cursorbewegung) und nicht als Reaktion
        // auf die eigenen Seitenumbruch-Transaktionen
        const onDocUpdate = ({ transaction } = {}) => {
            if (transaction?.getMeta(PAGINATION_META)) return;
            if (timeoutId) clearTimeout(timeoutId);
            // Debounce 50ms – Balance zwischen Reaktivität und Performance
            timeoutId = setTimeout(() => {
                requestAnimationFrame(handlePagination);
            }, 50);
        };

        editor.on('update', onDocUpdate);

        // Webfont 'Open Sans' aktiv anfordern – sonst misst die Pagination mit der
        // Ersatzschrift (Arial); der Druck nutzt Open Sans und bricht Seiten anders um.
        if (document.fonts && typeof document.fonts.load === 'function') {
            document.fonts.load("11pt 'Open Sans'");
            document.fonts.load("italic 11pt 'Open Sans'");
            document.fonts.load("700 11pt 'Open Sans'");
            document.fonts.load("8pt 'Open Sans'");
        }

        // Initial pagination after content is loaded (DOM muss fertig sein)
        rafId = requestAnimationFrame(() => {
            timeoutId = setTimeout(handlePagination, 300);
        });

        // Sobald die Webfont vollständig geladen ist, mit den ECHTEN Schriftmaßen neu
        // paginieren -> Editor-Seitenumbruch entspricht dann exakt dem Druck (WYSIWYG).
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => {
                if (cancelled) return;
                rafId = requestAnimationFrame(handlePagination);
            });
        }

        return () => {
            cancelled = true;
            if (timeoutId) clearTimeout(timeoutId);
            if (rafId) cancelAnimationFrame(rafId);
            editor.off('update', onDocUpdate);
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

    // Eigene Vorlagen: je Typ nur EIN Eintrag (Portfolio-Fassung vor Standard-Fassung)
    const customTemplateEntries = useMemo(() => {
        const byType = new Map();
        (customTemplates || []).forEach(row => {
            if (!row || !row.type) return;
            const list = byType.get(row.type) || [];
            list.push(row);
            byType.set(row.type, list);
        });
        const entries = [];
        byType.forEach((rows, type) => {
            const preferred = rows.find(r => effectivePortfolioId !== 'global' && r.portfolio_id === effectivePortfolioId)
                || rows.find(r => !r.portfolio_id && r.user_id === userId)
                || rows[0];
            entries.push({ type, row: preferred, versions: rows.length });
        });
        return entries;
    }, [customTemplates, effectivePortfolioId, userId]);

    // Combine system and custom templates
    const allTemplates = [
        ...SYSTEM_TEMPLATES.map(t => ({ ...t, isCustom: false })),
        ...customTemplateEntries.map(({ type, row, versions }) => ({
            id: type,
            label: row.name,
            hasSubject: true,
            variables: getVariablesForCategory(row.category),
            group: row.category || 'Eigene',
            isCustom: true,
            dbId: row.id,
            rowUserId: row.user_id,
            rowPortfolioId: row.portfolio_id,
            versions
        }))
    ];

    const activeConfigExact = allTemplates.find(t => t.id === activeType) || null;
    const activeConfig = activeConfigExact || allTemplates[0];

    // Werte aller Platzhalter (Editor-Anzeige, Live-Vorschau und Druck nutzen dieselben)
    const variableValues = useMemo(() => buildVariableValues({
        tenant: tenantState,
        portfolio: activePortfolio,
        manualValues,
        group: activeConfig?.group,
        dates
    }), [tenantState, activePortfolio, manualValues, activeConfig?.group, dates]);

    // NodeViews der Platzhalter im Editor mit den aktuellen Werten neu zeichnen und neu umbrechen
    useEffect(() => {
        chipValuesRef.current = variableValues;
        chipViewsRef.current.forEach(render => render());
        if (!editor || loading) return undefined;
        const rafId = requestAnimationFrame(() => runFullPagination(editor));
        return () => cancelAnimationFrame(rafId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [variableValues, editor, loading]);

    // Ungespeicherte Änderungen: beim Schließen/Neuladen des Browser-Tabs nachfragen
    useEffect(() => {
        if (!isDirty) return undefined;
        const onBeforeUnload = (event) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [isDirty]);

    // Rückfrage vor Aktionen, die den Editor-Inhalt ersetzen würden
    const confirmDiscardChanges = () => {
        if (!isDirty) return true;
        return window.confirm('Diese Vorlage hat ungespeicherte Änderungen. Änderungen verwerfen und fortfahren?');
    };

    const switchTemplate = (type) => {
        if (type === activeType) return;
        if (!confirmDiscardChanges()) return;
        setIsDirty(false);
        setActiveType(type);
    };

    const switchPortfolio = (portfolioId) => {
        if (portfolioId === effectivePortfolioId) return;
        if (!confirmDiscardChanges()) return;
        setIsDirty(false);
        setPortfolioTouched(true);
        setSelectedPortfolioId(portfolioId);
    };

    // Load templates from DB
    const fetchCustomTemplates = async () => {
        if (!userId) return;
        try {
            let query = supabase
                .from('document_templates')
                .select('*')
                .eq('is_custom', true);

            const portfolioIds = portfolioList.map(p => p.id);
            if (portfolioIds.length > 0) {
                query = query.or(`user_id.eq.${userId},portfolio_id.in.(${portfolioIds.join(',')})`);
            } else {
                query = query.eq('user_id', userId);
            }

            const { data, error } = await query;
            if (error) {
                console.error('Error fetching custom templates:', error);
                return;
            }
            setCustomTemplates(data || []);
        } catch (e) {
            console.error('Error fetching custom templates:', e);
        }
    };

    // Setzt den Editor-Inhalt beim Laden (nicht in der Undo-Historie, keine "Änderung")
    const setEditorContentFromLoad = (html) => {
        if (!editor) return;
        editor.chain()
            .setMeta(TEMPLATE_LOAD_META, true)
            .setMeta('addToHistory', false)
            .setContent(html || '')
            .run();
    };

    const loadTemplate = async () => {
        if (!userId || !editor) return;
        // Veraltete Antworten (schneller Vorlagen-/Portfoliowechsel) werden verworfen
        const seq = ++loadSeqRef.current;
        const isCurrent = () => seq === loadSeqRef.current;
        const type = activeType;
        const portfolioFilter = effectivePortfolioId === 'global' ? null : effectivePortfolioId;
        const isCustomType = String(type).startsWith('custom_');

        setLoading(true);
        setLoadError(null);
        setLoadNotice(null);

        const applyLoaded = (contentHtml, loadedSubject, loadSource, dbDataFound) => {
            if (!isCurrent()) return;
            const normalized = dbDataFound ? normalizeStoredTemplateHtml(contentHtml || '') : { html: contentHtml || '', changes: [] };
            setSubject(loadedSubject || '');
            setEditorContentFromLoad(normalized.html);
            // Nur mit Schreibrecht als "ungespeichert" markieren (Mitnutzer können nicht speichern)
            setIsDirty(normalized.changes.length > 0 && canWriteTemplates);
            setLoadNotice(normalized.changes.length > 0 ? normalized.changes : null);
            setDiagnostics({
                lastError: null,
                loadSource,
                dbDataFound,
                contentLength: (contentHtml || '').length
            });
        };

        const fetchGlobal = async () => {
            const { data, error } = await supabase
                .from('document_templates')
                .select('*')
                .eq('user_id', userId)
                .eq('type', type)
                .is('portfolio_id', null)
                .maybeSingle();
            if (error) throw error;
            return data;
        };

        try {
            let query = supabase
                .from('document_templates')
                .select('*')
                .eq('type', type);

            if (portfolioFilter) {
                query = query.eq('portfolio_id', portfolioFilter);
            } else {
                query = query.eq('user_id', userId).is('portfolio_id', null);
            }

            const { data, error } = await query.maybeSingle();
            if (!isCurrent()) return;
            if (error) throw error;

            if (data) {
                applyLoaded(data.content_html, data.subject, portfolioFilter ? 'Datenbank (Portfolio)' : 'Datenbank (Global)', true);
                return;
            }

            // Portfolio-Fassung fehlt: globale Fassung verwenden (gilt auch für eigene Vorlagen)
            if (portfolioFilter) {
                const globalData = await fetchGlobal();
                if (!isCurrent()) return;
                if (globalData) {
                    applyLoaded(globalData.content_html, globalData.subject, isCustomType ? 'Datenbank (Eigene Global)' : 'Datenbank (Global)', true);
                    return;
                }
            }

            if (isCustomType) {
                // Eigene Vorlage ohne gespeicherten Inhalt
                applyLoaded('', '', 'Datenbank (Eigene Leer)', false);
                return;
            }

            // Fallback to hardcoded defaults
            const defaultVal = DEFAULT_TEMPLATES[type] || { subject: '', content_html: '' };
            applyLoaded(defaultVal.content_html, defaultVal.subject, 'Hardcoded Default', false);
        } catch (error) {
            if (!isCurrent()) return;
            console.error('Error loading template:', error);
            // Standardtext anzeigen, aber Speichern sperren: sonst würde eine evtl. vorhandene
            // eigene Fassung beim nächsten Speichern überschrieben.
            const defaultVal = isCustomType ? { subject: '', content_html: '' } : (DEFAULT_TEMPLATES[type] || { subject: '', content_html: '' });
            applyLoaded(defaultVal.content_html, defaultVal.subject, 'Fehler-Fallback (Default)', false);
            const message = error?.message || String(error);
            setLoadError(message);
            setDiagnostics(prev => ({ ...prev, lastError: message }));
        } finally {
            if (isCurrent()) setLoading(false);
        }
    };

    useEffect(() => {
        if (userId) {
            fetchCustomTemplates();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, portfolios]);

    // Nur bei Wechsel von Vorlage, Portfolio oder Nutzer neu laden – NICHT bei Token-Erneuerung,
    // Tab-Wechsel oder Aktualisierung der Vorlagenliste (sonst gingen ungespeicherte Änderungen verloren).
    useEffect(() => {
        if (editor && userId) {
            setSelectedVariable(null);
            loadTemplate();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeType, effectivePortfolioId, editor, userId]);

    const reloadTemplate = () => {
        if (!confirmDiscardChanges()) return;
        setIsDirty(false);
        loadTemplate();
    };

    // Save template
    const handleSave = async () => {
        if (!userId || !editor) return;
        if (loadError) {
            alert('Die Vorlage konnte nicht geladen werden. Speichern ist gesperrt, damit Ihre gespeicherte Fassung nicht überschrieben wird. Bitte die Vorlage neu laden.');
            return;
        }
        if (!activeConfigExact) {
            alert('Diese Vorlage wurde nicht gefunden. Bitte die Seite neu laden.');
            return;
        }
        if (!canWriteTemplates) {
            alert('Portfolio-Vorlagen kann nur der Eigentümer des Portfolios ändern.');
            return;
        }
        const config = activeConfigExact;
        const portfolioFilter = effectivePortfolioId === 'global' ? null : effectivePortfolioId;
        // Hinweis: Wird eine global/standardmäßig geladene Vorlage gespeichert, während ein Portfolio gewählt ist,
        // entsteht eine portfolio-spezifische Kopie (die globale Vorlage bleibt unverändert).
        if (portfolioFilter && diagnostics.loadSource && diagnostics.loadSource !== 'Datenbank (Portfolio)') {
            const ok = window.confirm('Für dieses Portfolio existiert noch keine eigene Version dieser Vorlage. Beim Speichern wird eine portfolio-spezifische Kopie angelegt; die globale Vorlage bleibt unverändert. Fortfahren?');
            if (!ok) return;
        }
        setSaving(true);
        try {
            // Neutral serialisiert: nur Kennung und Bezeichnung der Platzhalter
            const contentHtml = editor.getHTML();

            let query = supabase
                .from('document_templates')
                .select('id')
                .eq('type', activeType);

            if (portfolioFilter) {
                query = query.eq('portfolio_id', portfolioFilter);
            } else {
                query = query.eq('user_id', userId).is('portfolio_id', null);
            }

            const { data: existingRecord, error: existingError } = await query.maybeSingle();
            if (existingError) throw existingError;

            const fields = {
                name: config.label || config.name,
                subject: config.hasSubject ? subject : null,
                content_html: contentHtml,
                is_custom: config.isCustom,
                category: config.group,
                updated_at: new Date().toISOString()
            };

            if (existingRecord) {
                // Globale Vorlage: user_id bleibt unverändert. Portfolio-Vorlage: Eigentümer ist der
                // Portfolio-Eigentümer (nur er darf speichern) – kein Besitzwechsel zu Mitnutzern.
                const updatePayload = portfolioFilter ? { ...fields, user_id: userId } : fields;
                const { data: updated, error: updateError } = await supabase
                    .from('document_templates')
                    .update(updatePayload)
                    .eq('id', existingRecord.id)
                    .select('id');
                if (updateError) throw updateError;
                if (!updated || updated.length === 0) {
                    throw new Error('Die Vorlage wurde nicht geändert (keine Berechtigung oder die Vorlage existiert nicht mehr).');
                }
            } else {
                const { data: inserted, error: insertError } = await supabase
                    .from('document_templates')
                    .insert([{ ...fields, user_id: userId, portfolio_id: portfolioFilter, type: activeType }])
                    .select('id');
                if (insertError) {
                    if (insertError.code === '23505') {
                        throw new Error('Zwischenzeitlich wurde eine andere Fassung dieser Vorlage gespeichert. Bitte die Vorlage neu laden.');
                    }
                    throw insertError;
                }
                if (!inserted || inserted.length === 0) {
                    throw new Error('Die Vorlage konnte nicht angelegt werden (keine Berechtigung).');
                }
            }

            setIsDirty(false);
            setLoadNotice(null);
            setDiagnostics(prev => ({
                ...prev,
                lastError: null,
                loadSource: portfolioFilter ? 'Datenbank (Portfolio)' : 'Datenbank (Global)',
                dbDataFound: true,
                contentLength: contentHtml.length
            }));
            if (config.isCustom) await fetchCustomTemplates();
            alert('Vorlage erfolgreich gespeichert.');
        } catch (error) {
            console.error('Error saving template:', error);
            alert('Fehler beim Speichern der Vorlage: ' + (error?.message || String(error)));
        } finally {
            setSaving(false);
        }
    };

    // Reset to defaults (system templates only)
    const handleReset = () => {
        if (activeConfig.isCustom) return;
        if (window.confirm('Möchten Sie diese Vorlage wirklich auf die Standardeinstellungen zurücksetzen? Ungespeicherte Änderungen gehen verloren. Gespeichert wird erst mit „Speichern“.')) {
            const defaultVal = DEFAULT_TEMPLATES[activeType] || { subject: '', content_html: '' };
            setSubject(defaultVal.subject || '');
            setEditorContentFromLoad(defaultVal.content_html || '');
            // Zurücksetzen ist eine (noch nicht gespeicherte) Änderung
            setIsDirty(true);
        }
    };

    // Create custom template
    const handleCreateTemplate = async () => {
        if (creating) return;
        if (!newTemplateName.trim()) return alert('Name fehlt.');
        if (!userId) return;
        if (!canWriteTemplates) {
            alert('Im Portfolio eines anderen Eigentümers können keine Vorlagen angelegt werden. Bitte „Standard (alle Portfolios)“ wählen.');
            return;
        }
        if (!confirmDiscardChanges()) return;
        setCreating(true);
        try {
            const portfolioFilter = effectivePortfolioId === 'global' ? null : effectivePortfolioId;
            const customType = `custom_${Date.now()}`;

            const payload = {
                user_id: userId,
                portfolio_id: portfolioFilter,
                type: customType,
                name: newTemplateName.trim(),
                subject: newTemplateSubject.trim() || null,
                content_html: `<p><span data-type="mention" data-id="mieter_anrede" data-label="Briefanrede">Briefanrede</span>,</p><p>Geben Sie hier Ihren Text ein...</p>`,
                is_custom: true,
                category: newTemplateCategory,
                updated_at: new Date().toISOString()
            };

            const { error } = await supabase
                .from('document_templates')
                .insert([payload]);

            if (error) throw error;

            setIsCreateModalOpen(false);
            setNewTemplateName('');
            setNewTemplateSubject('');
            setNewTemplateCategory('Eigene');

            await fetchCustomTemplates();
            setIsDirty(false);
            setActiveType(customType);
        } catch (error) {
            alert('Fehler beim Erstellen der Vorlage: ' + (error?.message || String(error)));
        } finally {
            setCreating(false);
        }
    };

    // Delete custom template (die angezeigte Fassung)
    const handleDeleteTemplate = async (template) => {
        if (!template?.dbId) return;
        const portfolioName = template.rowPortfolioId
            ? (portfolioList.find(p => p.id === template.rowPortfolioId)?.name || 'Portfolio')
            : null;
        const versionText = portfolioName
            ? `die Fassung für das Portfolio „${portfolioName}“`
            : 'die Standard-Fassung (alle Portfolios)';
        const moreText = template.versions > 1 ? ' Weitere Fassungen dieser Vorlage bleiben erhalten.' : '';
        if (!window.confirm(`Möchten Sie ${versionText} der Vorlage „${template.label}“ wirklich löschen?${moreText}`)) return;
        try {
            const { data: deleted, error } = await supabase
                .from('document_templates')
                .delete()
                .eq('id', template.dbId)
                .select('id');

            if (error) throw error;
            if (!deleted || deleted.length === 0) {
                throw new Error('Die Vorlage wurde nicht gelöscht (keine Berechtigung oder bereits entfernt).');
            }

            await fetchCustomTemplates();
            if (template.id === activeType && template.versions <= 1) {
                // zur nächsten Vorlage derselben Gruppe wechseln (sonst erste Systemvorlage)
                const sameGroup = allTemplates.filter(t => t.group === template.group && t.id !== template.id);
                setIsDirty(false);
                setActiveType(sameGroup[0]?.id || SYSTEM_TEMPLATES[0].id);
            } else if (template.id === activeType) {
                // andere Fassung derselben Vorlage laden
                setIsDirty(false);
                loadTemplate();
            }
        } catch (error) {
            alert('Fehler beim Löschen: ' + (error?.message || String(error)));
        }
    };

    // Löschen nur für eigene Fassungen bzw. als Portfolio-Eigentümer anbieten
    const canDeleteTemplate = (template) => {
        if (!template?.isCustom || !template.dbId) return false;
        if (template.rowUserId === userId) return true;
        const owner = template.rowPortfolioId ? portfolioList.find(p => p.id === template.rowPortfolioId)?.user_id : null;
        return !!owner && owner === userId;
    };

    // Insert variable chip into editor
    const insertVariable = (variable) => {
        setSelectedVariable(variable);
        if (!editor || showLivePreview) return;

        editor.chain().focus().insertContent({
            type: 'mention',
            attrs: {
                id: variable.id,
                label: variable.label
            }
        }).insertContent(' ').run();
    };

    // Bild / Unterschrift einfügen (PNG/JPEG/WebP/GIF, wird bei Bedarf verkleinert)
    const handleImageInsert = async (e) => {
        const input = e.target;
        const file = input.files && input.files[0];
        // Auswahl zurücksetzen, damit dieselbe Datei erneut gewählt werden kann
        input.value = '';
        if (!file || !editor) return;
        try {
            const src = await prepareImageForEmbedding(file);
            if (src) editor.chain().focus().setImage({ src }).run();
        } catch (err) {
            alert(err?.message || 'Das Bild konnte nicht eingefügt werden.');
        }
    };

    // Druck-/PDF-Vorschau: gleiche Auflösung wie die Live-Vorschau, getrenntes Fenster
    const openPrintPreview = (resolved) => {
        const notices = [];
        if (!isRealMode) {
            notices.push({ type: 'info', text: 'Vorschau mit Beispieldaten (gelb markiert) – kein versandfertiges Dokument. Echte Dokumente erstellst du über „Dokument erstellen“ beim Mieter.' });
        }
        if (resolved.missing.length > 0) {
            notices.push({ type: 'warning', text: `Fehlende Angaben (im Dokument rot markiert): ${resolved.missing.join(', ')}` });
        }
        if (resolved.error) {
            notices.push({ type: 'warning', text: 'Die Platzhalter konnten nicht aufgelöst werden.' });
        }
        openPrintWindow({
            bodyHtml: resolved.html,
            title: `PDF Vorschau - ${activeConfig.label || activeConfig.name || 'Dokument'}`,
            notices
        });
    };

    const handlePrintPreview = () => {
        if (!editor) return;
        const resolved = resolveTemplateHtml(editor.getHTML(), variableValues);
        if (isRealMode && (resolved.missing.length > 0 || resolved.error)) {
            // Erst warnen; der Klick auf "Trotzdem öffnen" öffnet das Fenster (Pop-up-Blocker)
            setPrintWarning({ missing: resolved.missing, error: resolved.error });
            return;
        }
        openPrintPreview(resolved);
    };

    const confirmPrintAnyway = () => {
        setPrintWarning(null);
        if (!editor) return;
        openPrintPreview(resolveTemplateHtml(editor.getHTML(), variableValues));
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

    // Bearbeitungs-Werkzeuge in der Live-Vorschau sperren (sie würden den unsichtbaren Entwurf ändern)
    const editingDisabled = !editor || showLivePreview;
    // Einmal pro Render statt einmal je Brief-Bereich
    const presentSections = editor && !showLivePreview ? getPresentSections() : {};
    // Live-Vorschau: aufgelöstes, maskiertes HTML (nur berechnet, wenn sichtbar)
    const livePreviewSource = showLivePreview && editor ? editor.getHTML() : '';
    const livePreview = useMemo(
        () => (livePreviewSource ? resolveTemplateHtml(livePreviewSource, variableValues) : null),
        [livePreviewSource, variableValues]
    );
    // Echtdaten-Modus: im Dokument verwendete Platzhalter ohne Wert (zum Eintragen)
    const missingInputs = [];
    if (isRealMode && editor && !loading) {
        const baseValues = manualValues && Object.keys(manualValues).length > 0
            ? buildVariableValues({ tenant: tenantState, portfolio: activePortfolio, manualValues: {}, group: activeConfig?.group, dates })
            : variableValues;
        collectUsedVariables(editor.state.doc).forEach((label, id) => {
            if (!lookupVariable(baseValues, id)) missingInputs.push({ id, label, isTable: TABLE_VARIABLE_IDS.has(id), multiline: MULTILINE_VARIABLE_IDS.has(id) });
        });
    }
    const missingStillOpen = missingInputs.filter(item => item.isTable || isBlank(manualValues[item.id]));
    const tenantDisplayName = tenantState ? (joinParts([tenantState.first_name, tenantState.last_name], ' ') || 'Mieter') : '';
    const templateHint = isRealMode ? TEMPLATE_HINTS[activeType] : null;
    const landlordMissing = !activePortfolio;
    void editorTick; // Re-Render-Auslöser für Toolbar-Status und Platzhalter-Liste

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
                ${LETTER_CONTENT_CSS}
                /* Platzhalter im Editor: hervorgehoben, aber ohne eigene Abstände/Schriftgröße,
                   damit der Seitenumbruch im Editor dem Druck entspricht (WYSIWYG). */
                .ProseMirror .variable-chip {
                    display: inline !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    border: none !important;
                    border-radius: 2px !important;
                    font-size: inherit !important;
                    font-weight: inherit !important;
                    font-family: inherit !important;
                    line-height: inherit !important;
                    white-space: normal !important;
                    background-color: #e0f2fe !important;
                    color: #0369a1 !important;
                    box-shadow: 0 0 0 1px #bae6fd;
                    cursor: grab !important;
                }
                .ProseMirror .variable-chip.expanded-variable-table {
                    display: block !important;
                    width: 100% !important;
                    background-color: transparent !important;
                    color: inherit !important;
                    box-shadow: none;
                    outline: 2px dashed #7dd3fc;
                    outline-offset: 2px;
                    user-select: none !important;
                }
                .ProseMirror .variable-chip .tpl-missing {
                    color: #b91c1c !important;
                }
                .tpl-banner {
                    display: flex;
                    gap: 10px;
                    align-items: flex-start;
                    padding: 10px 14px;
                    border-radius: 8px;
                    font-size: 0.85rem;
                    line-height: 1.45;
                    margin-bottom: 1rem;
                }
                .tpl-banner-info { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; }
                .tpl-banner-warning { background: #fef3c7; border: 1px solid #fcd34d; color: #78350f; }
                .tpl-banner-error { background: #fee2e2; border: 1px solid #fca5a5; color: #7f1d1d; }
                .tpl-banner button { cursor: pointer; }
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
                        value={effectivePortfolioId}
                        onChange={e => switchPortfolio(e.target.value)}
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
                    disabled={!canWriteTemplates}
                    title={canWriteTemplates ? undefined : 'Im Portfolio eines anderen Eigentümers können keine Vorlagen angelegt werden.'}
                >
                    Neue Vorlage
                </Button>
            </div>

            {/* Echtdaten-Modus ("Dokument erstellen" beim Mieter) */}
            {isRealMode && (
                <div className="tpl-banner tpl-banner-info">
                    <Info size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <div>
                        <strong>Dokument für {tenantDisplayName}</strong>
                        {tenantState?.einheit_name ? ` (${tenantState.einheit_name})` : ''}: Die Platzhalter werden mit den echten Mieter- und Vertragsdaten gefüllt. Fehlende Angaben sind rot markiert und werden nicht durch Beispielwerte ersetzt – trage sie unten ein.
                        {landlordMissing && (
                            <div style={{ marginTop: '4px', fontWeight: 600 }}>
                                Bitte oben das Portfolio des Mieters wählen – sonst fehlen Vermieter-Name, Anschrift, Kontakt und Bankverbindung.
                            </div>
                        )}
                        {templateHint && (
                            <div style={{ marginTop: '4px' }}>{templateHint}</div>
                        )}
                    </div>
                </div>
            )}
            {!canWriteTemplates && (
                <div className="tpl-banner tpl-banner-warning">
                    <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <div>Nur Lesezugriff: Die Vorlagen dieses Portfolios kann nur der Eigentümer des Portfolios ändern.</div>
                </div>
            )}
            {loadError && (
                <div className="tpl-banner tpl-banner-error">
                    <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <div style={{ flex: 1 }}>
                        Die Vorlage konnte nicht geladen werden. Angezeigt wird der Standardtext; <strong>Speichern ist gesperrt</strong>, damit Ihre gespeicherte Fassung nicht überschrieben wird.
                    </div>
                    <Button size="sm" variant="secondary" onClick={reloadTemplate}>Erneut laden</Button>
                </div>
            )}
            {loadNotice && (
                <div className="tpl-banner tpl-banner-warning">
                    <Info size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <div>
                        Diese gespeicherte Vorlage wurde beim Laden automatisch bereinigt: {loadNotice.join('; ')}. Bitte prüfen und speichern, um die Bereinigung zu übernehmen.
                    </div>
                </div>
            )}

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
                                            onClick={() => switchTemplate(t.id)}
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
                                        
                                        {canDeleteTemplate(t) && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t); }}
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
                                    const isPresent = presentSections[secClass];
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
                                                                if (nodePos === -1) {
                                                                    nodePos = pos;
                                                                }
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
                                        const payload = JSON.stringify({ type: 'mention', id: v.id });
                                        e.dataTransfer.setData(VARIABLE_DRAG_MIME, payload);
                                        e.dataTransfer.setData('text/plain', payload);
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
                                        <li>Mit Mietername: <em>„Sehr geehrte/r [Vorname Nachname]“</em></li>
                                        <li>Ohne Name: <em>„Sehr geehrte Damen und Herren“</em></li>
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
                            {/* Echtdaten-Modus: fehlende Angaben für dieses Dokument eintragen */}
                            {isRealMode && missingInputs.length > 0 && (
                                <div style={{ border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '0.875rem', color: '#78350f' }}>
                                        <AlertTriangle size={16} />
                                        Angaben für dieses Dokument ({missingStillOpen.length} offen)
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: '#78350f' }}>
                                        Diese Platzhalter haben keinen Wert aus den Mieter- bzw. Portfoliodaten. Eingetragene Werte gelten nur für dieses Dokument und werden nicht in der Vorlage gespeichert.
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
                                        {missingInputs.map(item => (
                                            <label key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                <span style={{ fontWeight: 600 }}>{item.label}</span>
                                                {item.isTable ? (
                                                    <span style={{ fontSize: '0.72rem', color: '#92400e' }}>
                                                        Tabelle – wird nur beim Erstellen aus dem jeweiligen Modul (Forderungen, Nebenkosten, Rechnungen) gefüllt.
                                                    </span>
                                                ) : item.multiline ? (
                                                    <textarea
                                                        rows={2}
                                                        value={manualValues[item.id] || ''}
                                                        onChange={e => updateManualValue(item.id, e.target.value)}
                                                        style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem', fontFamily: 'inherit', resize: 'vertical' }}
                                                    />
                                                ) : (
                                                    <input
                                                        type="text"
                                                        value={manualValues[item.id] || ''}
                                                        onChange={e => updateManualValue(item.id, e.target.value)}
                                                        style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}
                                                    />
                                                )}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {overflowPages.length > 0 && !showLivePreview && (
                                <div className="tpl-banner tpl-banner-warning" style={{ marginBottom: 0 }}>
                                    <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                                    <div>
                                        Auf Seite {overflowPages.join(', ')} passt der Inhalt nicht in den Textbereich und würde im Druck abgeschnitten. Bitte den Absatz bzw. die Tabelle kürzen oder teilen.
                                    </div>
                                </div>
                            )}
                            {/* Editor Toolbar & Canvas */}
                            <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}>


                                {/* Toolbar */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '8px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', alignItems: 'center' }}>
                                    <button 
                                        type="button"
                                        onClick={() => editor?.chain().focus().toggleBold().run()} 
                                        disabled={editingDisabled}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive('bold') ? '#e2e8f0' : 'transparent' }}
                                        title="Fett"
                                    >
                                        <Bold size={16} />
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => editor?.chain().focus().toggleItalic().run()} 
                                        disabled={editingDisabled}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive('italic') ? '#e2e8f0' : 'transparent' }}
                                        title="Kursiv"
                                     >
                                         <Italic size={16} />
                                     </button>
                                     <button 
                                         type="button"
                                         onClick={() => editor?.chain().focus().toggleUnderline().run()} 
                                         disabled={editingDisabled}
                                         style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive('underline') ? '#e2e8f0' : 'transparent' }}
                                         title="Unterstreichen"
                                     >
                                         <UnderlineIcon size={16} />
                                     </button>
                                     
                                     <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 4px' }} />

                                     {/* Formatierung Dropdown */}
                                     <select
                                         disabled={editingDisabled}
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
                                         disabled={editingDisabled}
                                         style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive({ textAlign: 'left' }) ? '#e2e8f0' : 'transparent' }}
                                         title="Linksbündig"
                                     >
                                         <AlignLeft size={16} />
                                     </button>
                                     <button 
                                         type="button"
                                         onClick={() => editor?.chain().focus().setTextAlign('center').run()} 
                                         disabled={editingDisabled}
                                         style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive({ textAlign: 'center' }) ? '#e2e8f0' : 'transparent' }}
                                         title="Zentriert"
                                     >
                                         <AlignCenter size={16} />
                                     </button>
                                     <button 
                                         type="button"
                                         onClick={() => editor?.chain().focus().setTextAlign('right').run()} 
                                         disabled={editingDisabled}
                                         style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive({ textAlign: 'right' }) ? '#e2e8f0' : 'transparent' }}
                                         title="Rechtsbündig"
                                     >
                                         <AlignRight size={16} />
                                     </button>
                                     <button 
                                         type="button"
                                         onClick={() => editor?.chain().focus().setTextAlign('justify').run()} 
                                         disabled={editingDisabled}
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


                                                 disabled={editingDisabled}


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
                                        disabled={editingDisabled}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: editor?.isActive('bulletList') ? '#e2e8f0' : 'transparent' }}
                                        title="Aufzählungsliste"
                                    >
                                        <List size={16} />
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => editor?.chain().focus().toggleOrderedList().run()} 
                                        disabled={editingDisabled}
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
                                        disabled={editingDisabled}
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
                                        disabled={editingDisabled}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                                        title="Bild / Unterschrift einfügen"
                                    >
                                        <ImageIcon size={16} />
                                    </button>
                                    <input 
                                        id="template-image-upload"
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp,image/gif"
                                        onChange={handleImageInsert} 
                                        style={{ display: 'none' }} 
                                    />

                                    <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 4px' }} />

                                    <button 
                                        type="button"
                                        onClick={() => editor?.chain().focus().undo().run()} 
                                        disabled={editingDisabled}
                                        style={{ padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                                        title="Rückgängig"
                                    >
                                        <Undo size={16} />
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => editor?.chain().focus().redo().run()} 
                                        disabled={editingDisabled}
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
                                            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={handleReset} disabled={editingDisabled} style={{ color: 'var(--text-secondary)' }}>
                                                Standard
                                            </Button>
                                        )}
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            icon={Save}
                                            onClick={handleSave}
                                            disabled={saving || !!loadError || !canWriteTemplates}
                                            title={loadError ? 'Speichern gesperrt: Die Vorlage konnte nicht geladen werden.' : (!canWriteTemplates ? 'Nur der Portfolio-Eigentümer kann diese Vorlage ändern.' : undefined)}
                                        >
                                            {saving ? 'Speichert…' : (isDirty ? 'Speichern *' : 'Speichern')}
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
                                     {showLivePreview && !isRealMode && livePreview?.hasExamples && (
                                         <div className="tpl-banner tpl-banner-warning" style={{ width: '100%', marginBottom: 0 }}>
                                             <Info size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                                             <div>Vorschau mit Beispieldaten (gelb markiert). Vermieterdaten stammen aus dem gewählten Portfolio, fehlende Angaben sind rot markiert. Echte Dokumente erstellst du über „Dokument erstellen“ beim Mieter.</div>
                                         </div>
                                     )}
                                     {showLivePreview ? (
                                         // Werte sind maskiert und das Ergebnis bereinigt (resolveTemplateHtml)
                                         <div ref={previewContainerRef} className="preview-live-container" dangerouslySetInnerHTML={{ __html: livePreview?.html || '' }} />
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
                                                <button onClick={() => updateLayoutStyles({ 'margin-top': 0, 'margin-bottom': 0, height: 0, width: 0 })}
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
                        <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)} disabled={creating}>Abbrechen</Button>
                        <Button variant="primary" onClick={handleCreateTemplate} disabled={creating}>{creating ? 'Wird erstellt…' : 'Erstellen'}</Button>
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

            {/* Warnung vor dem Druck: fehlende Angaben im Echtdaten-Modus */}
            <Modal
                isOpen={!!printWarning}
                onClose={() => setPrintWarning(null)}
                title="Fehlende Angaben im Dokument"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setPrintWarning(null)}>Zurück und ergänzen</Button>
                        <Button variant="primary" onClick={confirmPrintAnyway}>Trotzdem öffnen</Button>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.875rem' }}>
                    <p style={{ margin: 0 }}>
                        Für folgende Platzhalter liegen keine Daten vor. Sie werden im Dokument <strong style={{ color: '#b91c1c' }}>rot markiert</strong> gedruckt – es werden keine Beispielwerte eingesetzt:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '18px', listStyleType: 'disc' }}>
                        {(printWarning?.missing || []).map(label => <li key={label}>{label}</li>)}
                    </ul>
                    {printWarning?.error && (
                        <p style={{ margin: 0, color: 'var(--danger-color)' }}>Die Platzhalter konnten nicht vollständig aufgelöst werden.</p>
                    )}
                    <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                        Tipp: Fehlende Werte im Bereich „Angaben für dieses Dokument“ eintragen bzw. das Portfolio des Mieters wählen.
                    </p>
                </div>
            </Modal>

            {/* Diagnose-Tools (nur in der Entwicklungsumgebung) */}
            {import.meta.env.DEV && (
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
                        🛠️ Editor-Diagnose (nur Entwicklung)
                    </summary>
                    <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div><strong>User Status:</strong> {user ? 'Eingeloggt' : 'Nicht eingeloggt'}</div>
                        <div><strong>Editor Status:</strong> {editor ? 'Initialisiert und geladen' : 'Nicht initialisiert'}</div>
                        <div><strong>Lade-Status:</strong> {loading ? 'Lädt...' : 'Bereit'}</div>
                        <div><strong>Aktive Vorlage (ID):</strong> {activeType}</div>
                        <div><strong>Aktives Portfolio (ID):</strong> {effectivePortfolioId}</div>
                        <div><strong>Datenquelle:</strong> {diagnostics.loadSource}</div>
                        <div><strong>Eintrag in DB gefunden:</strong> {diagnostics.dbDataFound ? 'Ja' : 'Nein'}</div>
                        <div><strong>Geladene HTML-Länge:</strong> {diagnostics.contentLength} Zeichen</div>
                        <div><strong>Ungespeicherte Änderungen:</strong> {isDirty ? 'Ja' : 'Nein'}</div>
                        {diagnostics.lastError && (
                            <div style={{ color: 'var(--danger-color)', padding: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '4px', borderLeft: '3px solid var(--danger-color)' }}>
                                <strong>Letzter Fehler:</strong> {diagnostics.lastError}
                            </div>
                        )}
                        <div style={{ marginTop: '8px' }}>
                            <Button size="xs" variant="secondary" onClick={reloadTemplate}>
                                Vorlage neu laden
                            </Button>
                        </div>
                    </div>
                </details>
            </div>
            )}
        </Card>
    );
};

export default DocumentTemplates;
