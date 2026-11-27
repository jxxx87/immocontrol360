import {
    LayoutDashboard, Building2, Users,
    Gauge, PenTool, Upload, Calculator, Receipt,
    PiggyBank, Wallet, MessageSquare, Ticket,
    TrendingUp, Hammer, Briefcase
} from 'lucide-react';

// Hinweis zu `image`: Echte Screenshots liegen in public/images und werden mit führendem
// '/images/...' angegeben; Schlüssel ohne '/' (ui_...) verweisen auf nachgebaute Ansichten
// in FeaturesPage.jsx (getVisualContent).
// Funktionslisten bitte nur mit dem pflegen, was die App tatsächlich kann (Stand 11/2026 geprüft).
export const featureCategories = [
    {
        id: 'ueberblick',
        title: 'Überblick & Struktur',
        description: 'Das Fundament für dein Immobilien-Business. Schaffe Ordnung in Stammdaten und behalte die Kontrolle.',
        modules: [
            {
                id: 'dashboard',
                title: 'Dashboard',
                subtitle: 'Dein Cockpit für tägliche Entscheidungen.',
                icon: LayoutDashboard,
                description: 'Alle relevanten Kennzahlen auf einen Blick. Einnahmen, Ausgaben, Leerstand und offene Forderungen werden laufend aus deinen Daten berechnet.',
                features: [
                    'Einnahmen & Ausgaben im Vergleich zum Vormonat',
                    'Leerstand & Belegungsquote',
                    'Anzeige der offenen Forderungen',
                    'Verlauf der letzten 6 Monate & letzte Buchungen'
                ],
                whyItMatters: 'Du musst nicht erst Excel öffnen, um zu wissen, wie dein Portfolio steht. Ein Blick genügt.',
                flow: ['Daten erfassen', 'Kennzahlen berechnen', 'Überblick behalten'],
                image: '/images/w_Dashboard.png', // Real screenshot
                type: 'laptop'
            },
            {
                id: 'immobilien',
                title: 'Immobilienmanagement',
                subtitle: 'Die digitale Bauakte.',
                icon: Building2,
                description: 'Verwalte Objekte und Einheiten in einer sauberen Struktur. Hinterlege Stammdaten zentral für alle Prozesse.',
                features: [
                    'Immobilien je Portfolio anlegen',
                    'Je Objekt beliebige Einheiten hinzufügen',
                    'Detaillierte Stammdaten immer schnell greifbar',
                    'Status vermietet oder Leerstand immer im Überblick'
                ],
                whyItMatters: 'Ohne saubere Datenbasis keine Automatisierung. Hier legst du den Grundstein für Skalierung.',
                flow: ['Objekt anlegen', 'Einheiten definieren', 'Daten verknüpfen'],
                image: 'ui_objekt_detail', // Rendered UI
                type: 'laptop'
            },
            {
                id: 'mietverhaeltnisse',
                title: 'Mietverhältnisse',
                subtitle: 'Verträge im Griff.',
                icon: Users,
                description: 'Verwalte aktive und beendete Mietverträge. Behalte Laufzeiten, Kautionen und letzte Mieterhöhungen im Auge.',
                features: [
                    'Vertragsdaten & Laufzeiten',
                    'Kautionsverwaltung',
                    'Letzte Mieterhöhungen immer im Blick',
                    'Historie aller Mieterwechsel'
                ],
                whyItMatters: 'Laufzeiten, Kautionen und Mieterhöhungen findest du sofort. Alles ist sauber und nachvollziehbar dokumentiert.',
                flow: ['Vertrag anlegen', 'Mieter zuweisen', 'Laufzeiten im Blick behalten'],
                image: 'ui_contract_detail', // Rendered UI
                type: 'laptop'
            }
        ]
    },
    {
        id: 'verwaltung-betrieb',
        title: 'Verwaltung & Betrieb',
        description: 'Optimiere das Tagesgeschäft. Von Zählerständen bis Dokumentenmanagement.',
        modules: [
            {
                id: 'zaehler',
                title: 'Zählermanagement',
                subtitle: 'Verbräuche exakt erfassen.',
                icon: Gauge,
                description: 'Erfasse Zählerstände digital und ordne die Zähler Objekten und Einheiten zu. So hast du alle Stände für die Abrechnung griffbereit.',
                features: [
                    'Zähler (Strom, Wasser, Gas, Wärme) verwalten',
                    'Stände mit Datum und Notiz erfassen',
                    'Ablesehistorie je Zähler',
                    'Suche & Filter nach Zählerart'
                ],
                whyItMatters: 'Falsche Zählerstände kosten Geld und Nerven bei der Abrechnung. Digitalisiere den Prozess.',
                flow: ['Zähler anlegen', 'Stand erfassen', 'Historie einsehen'],
                image: 'ui_meter_list',
                type: 'laptop'
            },
            {
                id: 'aushaenge',
                title: 'Digitale Aushänge',
                subtitle: 'Infos schnell verteilen.',
                icon: PenTool,
                description: 'Erstelle Aushänge (z. B. „Wasser abgestellt“) für ein Objekt und stelle sie deinen Mietern digital im Mieterportal bereit – auf Wunsch mit Bildern oder PDF-Anhang.',
                features: [
                    'Aushang je Objekt veröffentlichen',
                    'Bilder & PDF-Dateien anhängen',
                    'Sichtbar für deine Mieter im Mieterportal',
                    'Push-Benachrichtigung in der Android-App'
                ],
                whyItMatters: 'Kommunikation muss schnell gehen. Kein Zettel-Basteln mehr.',
                flow: ['Objekt wählen', 'Text & Anhänge erfassen', 'Veröffentlichen'],
                image: 'ui_notice_board',
                type: 'laptop'
            },
            {
                id: 'dokumente',
                title: 'Dokumentenmanagement',
                subtitle: 'Dein papierloses Büro.',
                icon: Upload,
                description: 'Speichere wichtige Unterlagen wie Nebenkostenabrechnungen direkt beim Mieter oder zentrale Dokumente je Objekt. Nutzen deine Mieter die Android-App, erhalten sie direkt eine Push-Benachrichtigung.',
                features: [
                    'Upload per Dateiauswahl',
                    'Zuordnung zu Objekt (allgemein) oder Mieter (persönlich)',
                    'Push-Benachrichtigung in der Android-App des Mieters (Nachrichten, Dokumente, Tickets)'
                ],
                whyItMatters: 'Finde jedes Dokument in Sekunden, egal wo du bist.',
                flow: ['Hochladen', 'Zuordnen', 'Wiederfinden'],
                image: 'ui_doc_manager',
                type: 'laptop'
            }
        ]
    },
    {
        id: 'finanzen',
        title: 'Finanzen & Abrechnung',
        description: 'Behalte deine Zahlen unter Kontrolle. Buchhaltung, Rechnungen und Nebenkosten leicht gemacht.',
        modules: [
            {
                id: 'buchhaltung',
                title: 'Finanzen / Buchhaltung',
                subtitle: 'Einnahmen & Ausgaben.',
                icon: PiggyBank,
                description: 'Erfasse Mieteingänge und laufende Kosten. Ordne sie direkt den passenden Kostenarten zu.',
                features: [
                    'Einnahmen, Ausgaben und Überschuss im Überblick',
                    'Buchungen manuell erfassen (automatische Bankanbindung in Vorbereitung)',
                    'Kostenarten für eine schnelle Nebenkostenabrechnung',
                    'Export deiner Buchungen als PDF'
                ],
                whyItMatters: 'Wenn du monatlich sauber buchst, hast du für die Steuererklärung alle Zahlen beisammen.',
                flow: ['Buchung erfassen', 'Kostenart wählen', 'Auswerten'],
                image: 'ui_finance_overview',
                type: 'laptop'
            },
            {
                id: 'rechnungen',
                title: 'Rechnungen schreiben (FEWO)',
                subtitle: 'Professionell abrechnen.',
                icon: Receipt,
                description: 'Du betreibst auch Kurzzeitvermietung, egal ob Ferienwohnung oder Monteurswohnung? Hier erstellst du Rechnungen direkt – ohne Word- oder Excel-Chaos.',
                features: [
                    'Eigene Rechnungsnummernkreise je Portfolio',
                    'PDF-Vorlage mit deinem Logo'
                ],
                whyItMatters: 'Professionelle Rechnungen sorgen für schnellere Zahlungseingänge.',
                flow: ['Empfänger wählen', 'Posten hinzufügen', 'PDF erstellen'],
                image: 'ui_invoice_creator',
                type: 'laptop'
            },
            {
                id: 'nebenkosten',
                title: 'Nebenkostenabrechnung',
                subtitle: 'Der Angstgegner, besiegt.',
                icon: Calculator,
                description: 'Erstelle Betriebskostenabrechnungen auf Basis deiner gebuchten Ausgaben. Individuelle Anpassungen sind jederzeit möglich.',
                features: [
                    'Umlageschlüssel individuell anpassbar',
                    'Vorauszahlungen gegenrechnen',
                    'PDF-Export je Mieter',
                    'PDF für den Mieter im Mieterportal ablegen (über Dokumente)'
                ],
                whyItMatters: 'Erspare dir Kopfschmerzen und langes Vor-dir-herschieben. Mach die Abrechnung mit wenigen Klicks selbst und stelle sie deinem Mieter im Mieterportal bereit.',
                flow: ['Kosten sammeln', 'Verteilen', 'Abrechnen'],
                image: 'ui_utility_billing',
                type: 'laptop'
            },
            {
                id: 'finanzierung',
                title: 'Finanzierungen verwalten',
                subtitle: 'Deine Kredite im Blick.',
                icon: Wallet,
                description: 'Verwalte Darlehen, Zinsbindungen und Tilgungspläne. So siehst du rechtzeitig, wann eine Anschlussfinanzierung ansteht.',
                features: [
                    'Tilgungsplan mit Restschuld-Verlauf',
                    'Hinweis auf auslaufende Zinsbindungen (Investor-Cockpit)',
                    'Aktuelle Konditionen je Objekt',
                    'LTV-Berechnung: Darlehen im Verhältnis zum Marktwert (Investor-Cockpit)'
                ],
                whyItMatters: 'Finanzierungskosten sind dein größter Hebel. Optimiere sie aktiv.',
                flow: ['Darlehen erfassen', 'Laufzeit verfolgen', 'Optimieren'],
                image: 'ui_loan_manager',
                type: 'laptop'
            }
        ]
    },
    {
        id: 'kommunikation',
        title: 'Kommunikation & Portale',
        description: 'Verbinde dich professionell mit Mietern, Handwerkern und Partnern.',
        modules: [
            {
                id: 'kontakte',
                title: 'Kontakte verwalten',
                subtitle: 'Dein Netzwerk.',
                icon: Briefcase,
                description: 'Ein zentrales Adressbuch für Mieter, Dienstleister wie Handwerker und Hausmeister sowie sonstige Kontakte.',
                features: [
                    'Kontakte nach Typ (Mieter, Dienstleister, Gast, Sonstiges)',
                    'Anruf & E-Mail mit einem Klick',
                    'E-Mails mit Anhang direkt aus der App (über dein eigenes Postfach)',
                    'Suche & Filter, Mieter auch nach Objekt'
                ],
                whyItMatters: 'Im Notfall (Rohrbruch) musst du nicht lange suchen. Ein Klick zum Handwerker.',
                flow: ['Kontakt anlegen', 'Typ zuordnen', 'Anrufen oder schreiben'],
                image: 'ui_contact_list',
                type: 'phone'
            },
            {
                id: 'nachrichten',
                title: 'Nachrichten-Zentrale',
                subtitle: 'Schluss mit WhatsApp.',
                icon: MessageSquare,
                description: 'Kommuniziere mit deinen Mietern direkt über das Mieterportal. Schnell und einfach, aber trotzdem professionell getrennt.',
                features: [
                    'Chat-ähnlicher Verlauf',
                    'Anhänge versenden',
                    'Trennung von Privatem'
                ],
                whyItMatters: 'Nachvollziehbare Dokumentation statt verstreuter Chats. Und Feierabend für dein privates Handy.',
                flow: ['Nachricht empfangen', 'Antworten', 'Verlauf behalten'],
                image: '/images/w_Nachrichten.png', // Real screenshot
                type: 'phone'
            },
            {
                id: 'mieterportal',
                title: 'Ticketsystem',
                subtitle: 'Selbstverwaltung 2.0',
                icon: Ticket,
                description: 'Das Herzstück der Entlastung. Mieter melden Schäden, senden Bilder und Daten selbstständig ein.',
                features: [
                    'Ticketsystem mit Foto-Upload',
                    'Status-Updates für Mieter (Nachricht im Portal, Push in der Android-App)',
                    'Beidseitige Kommentarfunktion'
                ],
                whyItMatters: 'Weniger Rückfragen und kein Zettelchaos: Deine Mieter melden Probleme strukturiert.',
                flow: ['Schaden melden', 'Status setzen', 'Lösung dokumentieren'],
                image: '/images/w-Ticketboard.png', // Real screenshot
                secondImage: '/images/w_Ticketerstellen.png', // Dual view
                type: 'dual'
            }
        ]
    },
    {
        id: 'investor',
        title: 'Investorportal & Wachstum',
        description: 'Tools für Profis. Prüfe Deals, kalkuliere Risiken und plane Sanierungen.',
        modules: [
            {
                id: 'investor-cockpit',
                title: 'Investor Cockpit',
                subtitle: 'Dein Bestand und deine Deals.',
                icon: TrendingUp,
                description: 'Alle wichtigen Kennzahlen deiner Bestandsobjekte auf einen Blick. Kalkuliere potenzielle Ankaufsobjekte sauber durch – alles an einem Ort.',
                features: [
                    'Kennzahlen deines Bestands (Cashflow, Rendite, LTV)',
                    'Alle gespeicherten Deals (Buy & Hold, Fix & Flip) gebündelt',
                    'Schnellkalkulation in der Übersicht',
                    'Hinweis auf auslaufende Zinsbindungen'
                ],
                whyItMatters: 'Gute Deals muss man schnell erkennen. Organisiere deinen Einkauf professionell.',
                flow: ['Deal erfassen', 'Durchrechnen', 'Entscheiden'],
                image: 'ui_investor_cockpit',
                type: 'laptop'
            },
            {
                id: 'buy-hold',
                title: 'Buy & Hold Rechner',
                subtitle: 'Langfristig rechnen.',
                icon: Calculator,
                description: 'Detaillierte Rendite-Kalkulation für Bestandsimmobilien. Prüfe den Cashflow vor und nach Steuern.',
                features: [
                    'Brutto- & Netto-Mietrendite',
                    'Eigenkapitalrendite & Cashflow vor/nach Steuern',
                    'Steuerliche Betrachtung (AfA, Grenzsteuersatz)',
                    'Szenario für die Anschlussfinanzierung (neuer Zins & Tilgung)'
                ],
                whyItMatters: 'Kaufe keine roten Zahlen. Der Rechner zeigt dir die ungeschminkte Wahrheit.',
                flow: ['Kaufpreis eingeben', 'Miete schätzen', 'Rendite sehen'],
                image: '/images/W_BuyandHold.png', // Real screenshot
                type: 'laptop'
            },
            {
                id: 'fix-flip',
                title: 'Fix & Flip Rechner',
                subtitle: 'Kurzfristiger Gewinn.',
                icon: Hammer,
                description: 'Kalkuliere Ankauf, Sanierung und Verkauf für den schnellen Exit. Ermittle deine Marge exakt.',
                features: [
                    'Gesamtinvestkalkulation',
                    'Ergebnis & Kennzahlen zeigen direkt, ob es sich lohnt',
                    'Verkaufspreis-Szenarien'
                ],
                whyItMatters: 'Beim Handeln liegt der Gewinn im Einkauf – und in der präzisen Kostenkalkulation.',
                flow: ['Ankauf kalkulieren', 'Sanierung planen', 'Exit simulieren'],
                image: '/images/w_FixandFlip.png', // Real screenshot
                type: 'laptop'
            },
            {
                id: 'sanierung',
                title: 'Sanierungsrechner',
                subtitle: 'Baukosten im Griff.',
                icon: Hammer,
                description: 'Detaillierte Baukostenplanung nach Gewerken. Vermeide Kostenexplosionen durch vergessene Positionen.',
                features: [
                    'Vordefinierte Gewerke (z. B. Boden, Bad, Elektro)',
                    'Mengen- & Einheitspreis-Kalkulation',
                    'Übertrag in die Deal-Kalkulation'
                ],
                whyItMatters: 'Sanierungen sprengen oft das Budget. Mit diesem Tool planst du realistisch.',
                flow: ['Gewerk wählen', 'Menge schätzen', 'Budget fixieren'],
                image: 'ui_renovation_calc',
                type: 'laptop'
            }
        ]
    }
];
