// Gemeinsame Eckdaten (Testphase/Tarife) – an EINER Stelle pflegen.
// Stand laut App: register-trial vergibt 10 Tage; in der Testphase ist alles freigeschaltet
// und es gilt die Business-Grenze (SubscriptionContext: 250 Einheiten).
export const TRIAL_DAYS = 10;
export const TRIAL_MAX_UNITS = 250;
export const PLAN_UNIT_LIMITS = { starter: 5, professional: 50, business: 250 };

// Jede Frage hat eine feste `id` – sie dient als Sprunganker (#id) auf der FAQ-Seite
// und zur gezielten Auswahl einzelner Fragen (getFaqItemsByIds), z. B. für die Startseite.
export const faqCategories = [
    {
        id: 'start-trial',
        label: 'Start & Testphase',
        items: [
            {
                id: 'fuer-wen',
                q: 'Für wen ist ImmoControlPro360 gemacht?',
                a: `Ideal für private und semi-professionelle Immobilieninvestoren mit 1 bis ${PLAN_UNIT_LIMITS.business} Einheiten, die ihr Portfolio effizient verwalten und skalieren möchten. Die Plattform eignet sich besonders für Selbstverwalter, die volle Kontrolle über ihre Zahlen und die Mieterkommunikation behalten wollen.`,
            },
            {
                id: 'test-umfang',
                q: `Was ist im ${TRIAL_DAYS}-Tage-Test enthalten?`,
                a: `Während der Testphase sind alle Funktionen freigeschaltet – inklusive Mieter- und Investorportal – und du kannst bis zu ${TRIAL_MAX_UNITS} Einheiten anlegen. Du kannst Objekte anlegen, Tickets testen und die Rechner nutzen. Nach dem Test gilt der Umfang des Tarifs, den du abschließt. Hast du mehr Einheiten angelegt, als dein Tarif umfasst, kannst du weitere Einheiten erst nach einem Wechsel in einen größeren Tarif hinzufügen.`,
            },
            {
                id: 'test-zahlungsdaten',
                q: 'Muss ich Zahlungsdaten für den Test angeben?',
                a: 'Nein. Der Test ist unverbindlich: Wir benötigen keine Kreditkarte oder Kontodaten von dir. Für die Registrierung genügen deine E-Mail-Adresse und ein Passwort.',
            },
            {
                id: 'test-ende',
                q: `Was passiert nach den ${TRIAL_DAYS} Tagen?`,
                a: 'Die Testphase endet automatisch – du musst nichts kündigen, und es entstehen keine Kosten. Danach ist die App gesperrt, bis du ein Abo abschließt. Mit einem Abo arbeitest du direkt mit deinen bisher angelegten Daten weiter.',
            },
            {
                id: 'test-verlaengern',
                q: 'Kann ich den Test verlängern?',
                a: 'In Ausnahmefällen können wir den Testzeitraum verlängern. Melde dich dazu einfach kurz beim Support, wenn du mehr Zeit zum Ausprobieren brauchst.',
            },
            {
                id: 'kuendigung',
                // Frühere Frage "Kann ich jederzeit kündigen?" – deren Anker bleibt gültig (W1c-06)
                legacyAnchors: ['kann-ich-jederzeit-k-ndigen'],
                q: 'Wie kann ich kündigen?',
                a: 'Du kündigst dein Abo in der App unter Einstellungen → Abrechnung & Abo („Abo verwalten“) im Kundenportal unseres Zahlungsdienstleisters Stripe. Die Kündigung wirkt zum Ende eines Abrechnungszeitraums (Monat bzw. Jahr); ohne Kündigung verlängert sich das Abo automatisch. Die genauen Kündigungsfristen findest du in unseren AGB. Die kostenlose Testphase endet dagegen von selbst und muss nicht gekündigt werden.',
            },
            {
                id: 'onboarding',
                q: 'Wie starte ich am schnellsten (Onboarding)?',
                a: 'In 3 Schritten: 1. Registrieren (E-Mail-Adresse und Passwort). 2. Erstes Objekt anlegen (Adresse & Einheiten). 3. Mieterdaten oder Finanzdaten (Kredit, Miete) eingeben – das Dashboard füllt sich automatisch. Hast du deinen Bestand schon in Excel, kannst du ihn alternativ über unsere Import-Vorlage übernehmen.',
            },
            {
                id: 'start-informationen',
                q: 'Welche Informationen brauche ich zum Start?',
                a: 'Am wichtigsten sind die Basisdaten deiner Objekte (Adresse, Baujahr, Fläche) und die aktuellen Mieteinnahmen. Kreditdaten und Details zu Mietern kannst du auch später ergänzen.',
            },
        ]
    },
    {
        id: 'preise-abos',
        label: 'Preise & Abos',
        items: [
            {
                id: 'plaene',
                q: 'Welche Pläne gibt es?',
                a: `Es gibt drei Pläne: Starter (für Einsteiger, bis ${PLAN_UNIT_LIMITS.starter} Einheiten), Professional (unser Bestseller, bis ${PLAN_UNIT_LIMITS.professional} Einheiten, inkl. Mieter- und Investorportal) und Business (bis ${PLAN_UNIT_LIMITS.business} Einheiten, zusätzlich mit Multi-User-Zugriff und priorisiertem Support).`,
            },
            {
                id: 'jahresrabatt',
                q: 'Was bedeutet der Jahresrabatt (-10 %)?',
                a: 'Wenn du dich für die jährliche Zahlweise entscheidest, sparst du rund 10 % gegenüber der monatlichen Zahlweise. Der Betrag wird einmal jährlich im Voraus abgebucht.',
            },
            {
                id: 'zahlweise-wechseln',
                legacyAnchors: ['kann-ich-monatlich-j-hrlich-wechseln'],
                q: 'Kann ich zwischen monatlicher und jährlicher Zahlweise wechseln?',
                a: 'Ja. Tarif und Zahlweise verwaltest du in der App unter Einstellungen → Abrechnung & Abo („Abo verwalten“) im Kundenportal unseres Zahlungsdienstleisters Stripe. Wie ein Wechsel verrechnet wird und ab wann er gilt, zeigt dir das Kundenportal vor der Bestätigung an.',
            },
            {
                id: 'einheiten-grenze',
                q: 'Gibt es eine Objektgrenze pro Plan?',
                a: `Ja, die Grenze richtet sich nach den Einheiten. Starter: ${PLAN_UNIT_LIMITS.starter} Einheiten. Professional: ${PLAN_UNIT_LIMITS.professional} Einheiten. Business: ${PLAN_UNIT_LIMITS.business} Einheiten. Falls du mehr benötigst, kontaktiere uns für einen Enterprise-Plan.`,
            },
            {
                id: 'objekt-einheit',
                q: 'Was zählt als „Objekt“ und was als „Einheit“?',
                a: 'Ein Objekt ist das Gebäude (z. B. ein Mehrfamilienhaus). Einheiten sind die einzelnen Wohnungen oder Gewerbeeinheiten darin (z. B. 8 Wohnungen). Die Tarifgrenzen richten sich nach der Anzahl der Einheiten.',
            },
            {
                id: 'mehrbenutzer',
                q: 'Gibt es Mehrbenutzerzugänge / Rollen & Rechte?',
                a: 'Ja, im Business-Plan kannst du weitere Nutzer (z. B. Mitarbeiter, Verwalter oder Partner) einladen und ihnen spezifische Zugriffsrechte zuweisen.',
            },
            {
                id: 'enterprise',
                q: 'Bietet ihr Enterprise mit Beratung an?',
                a: `Für Portfolios über ${PLAN_UNIT_LIMITS.business} Einheiten bieten wir individuelle Enterprise-Lösungen inkl. persönlichem Onboarding, Datenimport-Service und dediziertem Account Manager an.`,
            },
            {
                id: 'zahlungsmethoden',
                q: 'Welche Zahlungsmethoden werden unterstützt?',
                a: 'Die Zahlung läuft über den Zahlungsdienstleister Stripe. Welche Zahlarten (z. B. Kreditkarte) dir zur Verfügung stehen, siehst du direkt im Bezahlvorgang.',
            },
        ]
    },
    {
        id: 'funktionen',
        label: 'Funktionen',
        items: [
            {
                id: 'dashboard',
                q: 'Was ist das Portfolio-Dashboard?',
                a: 'Das Herzstück von ImmoControlPro360. Es fasst die Finanz- und Verwaltungsdaten deines Portfolios zusammen und zeigt dir Einnahmen und Ausgaben des laufenden Monats, Leerstand und Auslastung sowie offene Forderungen. Renditekennzahlen deiner Bestandsobjekte findest du im Investorportal.',
            },
            {
                id: 'mehrere-portfolios',
                q: 'Kann ich mehrere Portfolios verwalten?',
                a: 'Ja, du kannst Objekte in Portfolios gruppieren und so beispielsweise private Bestände sauber von gewerblichen oder GmbH-Beständen trennen und getrennt auswerten.',
            },
            {
                id: 'struktur',
                q: 'Kann ich Mieter, Einheiten und Objekte sauber trennen?',
                a: 'Absolut. Die Struktur ist hierarchisch: Portfolio → Objekt → Einheit → Mietvertrag → Mieter. So behältst du auch bei komplexen Beständen die Übersicht.',
            },
            {
                id: 'aenderungshistorie',
                q: 'Gibt es eine Historie von Änderungen?',
                a: 'Ein allgemeines Änderungsprotokoll (Audit-Log) gibt es derzeit nicht. Nachvollziehbar sind aber zum Beispiel der Verlauf jedes Tickets mit Kommentaren und Statusänderungen, die Ablesehistorie deiner Zähler, die Historie deiner Forderungen und beendete Mietverhältnisse.',
            },
            {
                id: 'benachrichtigungen',
                q: 'Gibt es Benachrichtigungen?',
                a: 'Ja. Neue Nachrichten, Dokumente, Aushänge und Tickets werden in der App angezeigt; wer die Android-App nutzt, erhält zusätzlich Push-Benachrichtigungen. Gerade für deine Mieter im Mieterportal ist das praktisch – so bleiben sie zuverlässig auf dem Laufenden.',
            },
            {
                id: 'automationen',
                q: 'Gibt es Automationen?',
                a: 'Aktuell konzentrieren wir uns auf semi-automatisierte Workflows (z. B. automatische Nachricht an den Mieter bei Ticket-Statusänderungen). Vollständige Automationen (z. B. Zapier-Integration) stehen auf unserer Roadmap.',
            },
        ]
    },
    {
        id: 'mieterportal-tickets',
        label: 'Mieterportal & Tickets',
        items: [
            {
                id: 'mieterportal',
                q: 'Was ist das Mieterportal?',
                a: 'Ein eigener Zugang für deine Mieter – im Browser oder in der Android-App. Sie können sich einloggen, ihre Vertragsdaten einsehen, Dokumente herunterladen, Nachrichten schreiben und – am wichtigsten – Störungsmeldungen (Tickets) aufgeben.',
            },
            {
                id: 'mieter-funktionen',
                q: 'Was kann der Mieter dort machen?',
                a: 'Der Mieter kann Schäden melden, Fotos hochladen, den Status seiner Tickets verfolgen und Dokumente abrufen, die du für ihn bereitstellst (z. B. Hausordnung, Betriebskostenabrechnung).',
            },
            {
                id: 'ticketsystem',
                q: 'Was ist das Ticketsystem?',
                a: 'Ein strukturierter Prozess für Schadensmeldungen: Störung wird gemeldet → Ticket erstellt → du prüfst bzw. beauftragst Handwerker → Ticket wird als abgeschlossen markiert. Kein Chaos mehr per WhatsApp.',
            },
            {
                id: 'ticket-status-prioritaet',
                q: 'Kann ich Ticket-Status und Priorität setzen?',
                a: 'Die Priorität (Niedrig, Normal, Hoch, Dringend) wird beim Anlegen des Tickets gewählt – vom Mieter oder von dir. Den Status (Eingegangen, In Bearbeitung, Abgeschlossen) änderst du jederzeit per Drag & Drop im Ticket-Board; der Mieter erhält dazu automatisch eine Nachricht.',
            },
            {
                id: 'ticket-fotos',
                q: 'Können Mieter Fotos/Anhänge in Tickets hochladen?',
                a: 'Ja, das ist ein zentrales Feature. Mieter können Fotos des Schadens direkt im Portal hochladen, was dir oft den Vor-Ort-Termin zur Begutachtung spart.',
            },
            {
                id: 'ticket-verlauf',
                q: 'Wie wird die Kommunikation dokumentiert?',
                a: 'Kommentare und Statusänderungen werden mit Datum und Uhrzeit im Verlauf des Tickets gespeichert. So kannst du jederzeit nachvollziehen, was wann passiert ist.',
            },
            {
                id: 'antwortvorlagen',
                q: 'Kann ich Standardantworten/Vorlagen nutzen?',
                a: 'Das ist derzeit noch nicht möglich. Die Funktion ist geplant, um die Kommunikation bei häufigen Anfragen noch schneller zu machen.',
            },
            {
                id: 'whatsapp-chaos',
                legacyAnchors: ['wie-verhindere-ich-chaos-durch-whatsapp-email'],
                q: 'Wie verhindere ich Chaos durch WhatsApp/E-Mail?',
                a: 'Indem du Mieter konsequent auf das Portal verweist. Die Vorteile (schnellere Bearbeitung, Status-Updates) überzeugen meist schnell. So landen keine Schäden mehr in deinem privaten Chat.',
            },
        ]
    },
    {
        id: 'investorportal-rechner',
        label: 'Investorportal & Rechner',
        items: [
            {
                id: 'investorportal',
                q: 'Was kann das Investorportal?',
                a: 'Das Investorportal hilft dir beim Wachstum. Hier siehst du alle Bestandsobjekte mit den wichtigsten Kennzahlen aus Investorsicht: Wo stehe ich aktuell, wo will ich hin? Zusätzlich bietet es Rechner zur Prüfung neuer Immobilien (Buy & Hold, Fix & Flip) sowie zur Kalkulation von Sanierungen und Exit-Szenarien.',
            },
            {
                id: 'buy-and-hold',
                q: 'Was berechnet der Buy & Hold Rechner?',
                a: 'Er ermittelt, ob sich ein Objekt zur langfristigen Vermietung lohnt. Berechnet werden u. a. Brutto- und Nettomietrendite, Eigenkapitalrendite und der monatliche Cashflow vor und nach Steuern.',
            },
            {
                id: 'fix-and-flip',
                q: 'Was berechnet der Fix & Flip Rechner?',
                a: 'Dieser Rechner ist für den schnellen Wiederverkauf optimiert. Er berücksichtigt Kaufnebenkosten, Sanierungskosten, Haltedauer-Kosten, Maklerprovisionen und Steuern, um deinen erwarteten Gewinn und die Marge zu ermitteln.',
            },
            {
                id: 'sanierungsrechner',
                q: 'Was kann der Sanierungsrechner?',
                a: 'Du kannst Sanierungskosten detailliert nach Gewerken (z. B. Boden, Bad, Elektro) schätzen und kalkulieren. Das hilft dir, das Gesamtbudget für ein Projekt realistisch einzuschätzen.',
            },
            {
                id: 'expose-import',
                q: 'Wie funktioniert der Exposé-Import?',
                a: 'Eine KI-gestützte Funktion, die Daten aus PDF-Exposés automatisch ausliest, ist in Planung. Aktuell gibst du die Eckdaten manuell ein – das geht schnell, und du behältst die volle Kontrolle.',
            },
        ]
    },
    {
        id: 'daten-sicherheit',
        label: 'Daten & Sicherheit',
        items: [
            {
                id: 'verschluesselung',
                q: 'Werden meine Daten verschlüsselt übertragen?',
                a: 'Ja. Die Verbindung zwischen deinem Gerät und ImmoControlPro360 läuft verschlüsselt über HTTPS.',
            },
            {
                id: 'zahlungsdaten-speicherung',
                q: 'Speichert ihr meine Zahlungsdaten?',
                a: 'Nein. Die Zahlungsdaten für dein Abo gibst du direkt auf der Bezahlseite unseres Zahlungsdienstleisters Stripe ein. ImmoControlPro360 speichert keine Kreditkarten- oder Kontodaten für dein Abo.',
            },
        ]
    },
    {
        id: 'technik-geraete',
        label: 'Technik & Geräte',
        items: [
            {
                id: 'geraete',
                legacyAnchors: ['funktioniert-es-auf-smartphone-tablet-desktop'],
                q: 'Funktioniert es auf Smartphone, Tablet und Desktop?',
                a: 'Ja. ImmoControlPro360 läuft als Web-App im Browser auf Smartphone, Tablet und Desktop; das Layout passt sich automatisch der Bildschirmgröße an. Für Android gibt es zusätzlich eine eigene App ohne Aufpreis.',
            },
            {
                id: 'ios-android',
                q: 'Unterstützt ihr iOS und Android?',
                a: 'Für Android gibt es eine eigene App, die unter anderem Push-Benachrichtigungen unterstützt. Eine iOS-App gibt es derzeit nicht – auf iPhone und iPad nutzt du ImmoControlPro360 über den Browser (z. B. Safari) und kannst die Web-App dort auch zum Home-Bildschirm hinzufügen.',
            },
            {
                id: 'browser',
                q: 'Welche Browser sind empfohlen?',
                a: 'Wir empfehlen moderne Browser wie Google Chrome, Safari, Firefox oder Microsoft Edge in der aktuellen Version für die beste Performance und Sicherheit.',
            },
        ]
    },
    {
        id: 'migration-setup',
        label: 'Migration & Setup',
        items: [
            {
                id: 'excel-import',
                q: 'Kann ich aus Excel importieren?',
                a: 'Ja. Über unsere Excel-Vorlage (XLSX) übernimmst du Portfolios, Objekte, Einheiten sowie Mieter mit ihren Mietverträgen, ohne alles abzutippen. Die Vorlage lädst du in der App unter Einstellungen → Import herunter.',
            },
            {
                id: 'import-formate',
                // frühere Frage „Kann ich das Mapping speichern?“ – die Antwort dazu steht jetzt hier
                legacyAnchors: ['kann-ich-das-mapping-speichern'],
                q: 'Welche Formate werden unterstützt?',
                a: 'Importiert wird das Excel-Format XLSX auf Basis unserer Vorlage. Die Spalten sind fest vorgegeben – eine eigene Spaltenzuordnung ist weder nötig noch möglich. Liegen deine Daten als CSV vor, öffnest du sie in Excel und überträgst sie in die Vorlage.',
            },
            {
                id: 'import-pruefung',
                q: 'Wird meine Datei vor dem Import geprüft?',
                a: 'Ja. Nach dem Hochladen prüft ImmoControlPro360 die Datei zuerst und zeigt dir eine Vorschau: was neu angelegt wird, was bereits vorhanden ist, sowie Fehler und Hinweise mit Zeilennummer. Bei Fehlern wird nichts importiert; erst nach deiner Bestätigung startet der eigentliche Import.',
            },
            {
                id: 'einrichtungsdauer',
                q: 'Wie lange dauert die Einrichtung?',
                a: 'Das hängt vom Umfang deines Bestands ab. Ein kleines Portfolio legst du schnell von Hand an; bei größeren Portfolios verkürzt der Excel-Import die Einrichtung deutlich.',
            },
            {
                id: 'import-hilfe',
                q: 'Könnt ihr beim Import helfen?',
                a: 'Im Business- und Enterprise-Plan unterstützen wir dich gerne persönlich beim Datenimport und der Ersteinrichtung, damit du sofort startklar bist.',
            },
        ]
    },
];

// Einzelne Fragen per id auswählen (Reihenfolge wie übergeben; unbekannte ids werden übersprungen).
export const getFaqItemsByIds = (ids) => {
    const byId = new Map(faqCategories.flatMap(cat => cat.items.map(item => [item.id, item])));
    return ids.map(id => byId.get(id)).filter(Boolean);
};
