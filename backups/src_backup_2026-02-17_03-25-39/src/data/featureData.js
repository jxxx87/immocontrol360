import {
    LayoutDashboard, Building2, Users, FileText,
    Gauge, PenTool, Upload, Calculator, Receipt,
    PiggyBank, Wallet, MessageSquare, Ticket,
    TrendingUp, Hammer, Search, Briefcase, Mail
} from 'lucide-react';

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
                description: 'Alle relevanten KPIs auf einen Blick. Cashflow, Leerstand und offene Tickets werden in Echtzeit aggregiert.',
                features: [
                    'Echtzeit-Cashflow & Rendite Analyse',
                    'Leerstands-Warner & Belegungsquote',
                    'Offene Aufgaben & dringende Tickets',
                    'Anzeige der offenen Forderungen'
                ],
                whyItMatters: 'Du musst nicht erst Excel öffnen, um zu wissen, wie dein Portfolio steht. Ein Blick genügt.',
                flow: ['Daten aggregieren', 'KPIs berechnen', 'Handlung empfehlen'],
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
                    'Status Vermietet oder Leerstand immer im Überblick'
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
                description: 'Verwalte aktive und beendete Mietverträge. Behalte Fristen, Kautionen und letzte Mieterhöhungen im Auge.',
                features: [
                    'Vertragsdaten & Laufzeiten',
                    'Kautionsverwaltung & Status',
                    'Letzte Mieterhöhungen immer im Blick',
                    'Historie aller Mieterwechsel'
                ],
                whyItMatters: 'Nie wieder Fristen verpassen oder Kautionen suchen. Alles ist rechtsbündig dokumentiert.',
                flow: ['Vertrag anlegen', 'Mieter zuweisen', 'Fristen überwachen'],
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
                description: 'Erfasse Zählerstände digital und ordne sie Objekten zu. Die Basis für korrekte Abrechnungen.',
                features: [
                    'Zähler (Wasser, Strom, Gas) verwalten',
                    'Stände mit Datum erfassen',
                    'Zählerwechsel dokumentieren',
                    'Plausibilitätsprüfung bei Eingabe'
                ],
                whyItMatters: 'Falsche Zählerstände kosten Geld und Nerven bei der Abrechnung. Digitalisiere den Prozess.',
                flow: ['Zähler definieren', 'Stand erfassen', 'Verbrauch berechnen'],
                image: 'ui_meter_list',
                type: 'laptop'
            },
            {
                id: 'aushaenge',
                title: 'Digitale Aushänge',
                subtitle: 'Infos schnell verteilen.',
                icon: PenTool,
                description: 'Erstelle Aushänge (z.B. „Wasser abgestellt“) und verteile sie digital oder als PDF an deine Mieter.',
                features: [
                    'Vorlagen für häufige Aushänge',
                    'Zuweisung zu Objekt/Einheit',
                    'Automatischer PDF-Export'
                ],
                whyItMatters: 'Kommunikation muss schnell gehen. Kein Word-Basteln mehr.',
                flow: ['Vorlage wählen', 'Text anpassen', 'Veröffentlichen'],
                image: 'ui_notice_board',
                type: 'laptop'
            },
            {
                id: 'dokumente',
                title: 'Dokumentenmanagement',
                subtitle: 'Dein papierloses Büro.',
                icon: Upload,
                description: 'Speichere Wichtige Informationen wie Nebenkostenabrechnungen direkt beim Mieter oder zentrale Dokumente je Objekt. Die Mieter erhalten eine direkt Push Benachrichtigung auf Ihr Handy.',
                features: [
                    'Drag & Drop Upload',
                    'Verknüpfung zu Objekt/Mieter/Ticket',
                    'Direkt Push Benachrichtigung auf dem Handy des Mieters (Nachricht, Dokumente, Tickets)'
                ],
                whyItMatters: 'Finde jedes Dokument in Sekunden, egal wo du bist.',
                flow: ['Upload', 'Tagging', 'Wiederfinden'],
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
                description: 'Erfasse Mieteingänge und laufende Kosten. Ordne sie direkt den passenden Steuer-Kategorien zu.',
                features: [
                    'Einnahmen/Überschuss-Rechnung',
                    'manueller Bankkonten-Abgleich (Automatisch Bankanbindung demnächst verfügbar)',
                    'Kategorisierung der Kostenart für Blitzschnelle Nebenkostenabrechnung',
                    'Alle Auswertungen direkt im Blick'
                ],
                whyItMatters: 'Die Steuererklärung wird zum Kinderspiel, wenn du monatlich sauber buchst.',
                flow: ['Buchung erfassen', 'Kategorie wählen', 'Auswerten'],
                image: 'ui_finance_overview',
                type: 'laptop'
            },
            {
                id: 'rechnungen',
                title: 'Rechnungen schreiben (FEWO)',
                subtitle: 'Professionell abrechnen.',
                icon: Receipt,
                description: 'Sie betreiben auch Kurzzeitvermietung egal ob Ferienwohnung oder Monteurswohnungen, hier erstellen Sie direkt Rechnungen ohne Word oder Excel Chaos.',
                features: [
                    'Eigene Nummernkreise getrennt nach Eigentümer',
                    'PDF- Vorlage mit Ihrem Logo'
                ],
                whyItMatters: 'Professionelle Rechnungen sorgen für schnellere Zahlungseingänge.',
                flow: ['Kunde wählen', 'Posten hinzufügen', 'Senden'],
                image: 'ui_invoice_creator',
                type: 'laptop'
            },
            {
                id: 'nebenkosten',
                title: 'Nebenkostenabrechnung',
                subtitle: 'Der Angstgegner, besiegt.',
                icon: Calculator,
                description: 'Erstelle Betriebskostenabrechnungen in 2 Minuten basierend auf deinen gebuchten Ausgaben. Individuelle Anpassungen jederzeit möglich.',
                features: [
                    'Umlageschlüssel individuell anpassbar',
                    'Vorauszahlungen gegenrechnen',
                    'Automatischer PDF-Export',
                    'Versand per E-Mail/Portal'
                ],
                whyItMatters: 'Erspare dir Kopfschmerzen und langes vor sich herschieben. Mach die Abrechnung mit wenigen Klicks selbst und hinterlege die beim Mieter im Mieterportal.',
                flow: ['Kosten sammeln', 'Verteilen', 'Abrechnen'],
                image: 'ui_utility_billing',
                type: 'laptop'
            },
            {
                id: 'finanzierung',
                title: 'Finanzierungen verwalten',
                subtitle: 'Deine Kredite im Blick.',
                icon: Wallet,
                description: 'Verwalte Darlehen, Zinsbindungen und Tilgungspläne. Verpasse keine Prolongation.',
                features: [
                    'Restschuld-Verlauf',
                    'Zinsbindungs-Warner',
                    'Aktuelle Konditionen je Objekt',
                    'LTV-Berechnung (Beleihungswert)'
                ],
                whyItMatters: 'Finanzierungskosten sind dein größter Hebel. Optimiere sie aktiv.',
                flow: ['Darlehen erfassen', 'Laufzeit tracken', 'Optimieren'],
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
                description: 'Ein zentrales Adressbuch für Handwerker, Hausmeister und Dienstleister, verknüpft mit Objekten.',
                features: [
                    'Kategorisierte Dienstleister-Liste',
                    'Schnellwahl & E-Mail',
                    'Zuordnung zu Gewerken',
                    'Notfall-Kontakte hinterlegen'
                ],
                whyItMatters: 'Im Notfall (Rohrbruch) musst du nicht lange suchen. Ein Klick zum Handwerker.',
                flow: ['Kontakt anlegen', 'Gewerk zuweisen', 'Beauftragen'],
                image: 'ui_contact_list',
                type: 'phone'
            },
            {
                id: 'nachrichten',
                title: 'Nachrichten Zentrale',
                subtitle: 'Schluss mit WhatsApp.',
                icon: MessageSquare,
                description: 'Kommuniziere mit deinen Mieter direkt über das Mieterportal. Schnell und einfach aber trotzdem Professionell getrennt.',
                features: [
                    'Chat-ähnlicher Verlauf',
                    'Anhänge versenden',
                    'Trennung von Privatem'
                ],
                whyItMatters: 'Rechtssicherheit durch Dokumentation. Und Feierabend für dein privates Handy.',
                flow: ['Nachricht empfangen', 'Antworten', 'Archivieren'],
                image: 'w_Nachrichten.png', // Real screenshot
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
                    'Status-Updates für Mieter (Push)',
                    'Beidseitige Kommentarfunktion'
                ],
                whyItMatters: 'Reduziere Rückfragen um bis zu 80%. Deine Mieter lösen Probleme strukturiert aus.',
                flow: ['Schaden melden', 'Ticket priorisieren', 'Lösung dokumentieren'],
                image: 'w-Ticketboard.png', // Real screenshot
                secondImage: 'w_Ticketerstellen.png', // Dual view
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
                subtitle: 'Deine Deal-Pipeline.',
                icon: TrendingUp,
                description: 'Alle wichtigen Kennzahlen deine Bestandsobjekte auf einen Blick. Verwalte potenzielle Ankaufs-Objekte bis zum Kauf mit sauberer Kalkulation und alles an einem Ort.',
                features: [
                    'Alle Deals gebündelt an einem Ort',
                    'Schnellkalkulation in der Übersicht',
                    'Status-Tracking (Prüfung, Angebot, Notar)',
                    'Dokumente zum Deal (Exposé)'
                ],
                whyItMatters: 'Gute Deals muss man schnell erkennen. Organisiere deinen Einkauf professionell.',
                flow: ['Deal erfassen', 'Vorprüfen', 'Entscheiden'],
                image: 'ui_investor_cockpit',
                type: 'laptop'
            },
            {
                id: 'buy-hold',
                title: 'Buy & Hold Rechner',
                subtitle: 'Langfristig Rechnen.',
                icon: Calculator,
                description: 'Detaillierte Rendite-Kalkulation für Bestandsimmobilien. Prüfe Cashflow vor/nach Steuer.',
                features: [
                    'Brutto- & Netto-Mietrendite',
                    'Eigenkapitalrendite & Cashflow ROI',
                    'Steuerliche Betrachtung (AfA, Steuersatz)',
                    'Zinssensitivitäts-Analyse'
                ],
                whyItMatters: 'Kaufe keine rote Zahlen. Der Rechner zeigt dir die ungeschminkte Wahrheit.',
                flow: ['Kaufpreis eingeben', 'Miete schätzen', 'Rendite sehen'],
                image: 'W_BuyandHold.png', // Real screenshot
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
                    'Ergebnis & KPI sagt direkt ob es sich lohnt',
                    'Verkaufspreis-Szenarien'
                ],
                whyItMatters: 'Beim Handeln liegt der Gewinn im Einkauf – und in der präzisen Kostenkalkulation.',
                flow: ['Ankauf kalkulieren', 'Sanierung planen', 'Exit simulieren'],
                image: 'w_FixandFlip.png', // Real screenshot
                type: 'laptop'
            },
            {
                id: 'sanierung',
                title: 'Sanierungsrechner',
                subtitle: 'Baukosten im Griff.',
                icon: Hammer,
                description: 'Detaillierte Baukostenplanung nach Gewerken. Vermeide Kostenexplosionen durch vergessen Positionen.',
                features: [
                    'Vordefinierte Gewerke (Boden, Bad, Elektro)',
                    'Mengen- & Einheitspreis-Kalkulation',
                    'Puffer für Unvorhergesehenes',
                    'Übertrag in Deal-Kalkulation'
                ],
                whyItMatters: 'Sanierungen sprengen oft das Budget. Mit diesem Tool planst du realistisch.',
                flow: ['Gewerk wählen', 'Menge schätzen', 'Budget fixieren'],
                image: 'ui_renovation_calc',
                type: 'laptop'
            }
        ]
    }
];
