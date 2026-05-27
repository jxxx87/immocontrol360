import React from 'react';
import MainLayout from '../layouts/MainLayout';

const Legal = ({ type }) => {
    const content = {
        impressum: {
            title: 'Impressum',
            body: (
                <>
                    <h2 className="text-xl font-bold mb-4 mt-6 text-slate-800">Angaben gemäß § 5 TMG</h2>
                    <p className="mb-6 leading-relaxed">
                        Johann Lutz<br />
                        Obere Himmelsbergstraße 137<br />
                        66482 Zweibrücken
                    </p>

                    <h2 className="text-xl font-bold mb-4 text-slate-800">Kontakt</h2>
                    <p className="mb-6 leading-relaxed">
                        E-Mail: support@immocontrolpro360.de
                    </p>

                    <h2 className="text-xl font-bold mb-4 text-slate-800">Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV</h2>
                    <p className="mb-6 leading-relaxed">
                        Johann Lutz<br />
                        Obere Himmelsbergstraße 137<br />
                        66482 Zweibrücken
                    </p>

                    <h2 className="text-xl font-bold mb-4 text-slate-800">Streitschlichtung</h2>
                    <p className="mb-6 leading-relaxed">
                        Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">https://ec.europa.eu/consumers/odr/</a>.<br />
                        Unsere E-Mail-Adresse finden Sie oben im Impressum. Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
                    </p>
                </>
            )
        },
        datenschutz: {
            title: 'Datenschutzerklärung',
            body: (
                <>
                    <h2 className="text-2xl font-bold mb-4 mt-6 text-slate-800">1. Datenschutz auf einen Blick</h2>
                    <h3 className="text-xl font-semibold mb-2 mt-4 text-slate-700">Allgemeine Hinweise</h3>
                    <p className="mb-6 leading-relaxed">
                        Die folgenden Hinweise geben einen einfachen Überblick darüber, was mit Ihren personenbezogenen Daten passiert, wenn Sie diese Website besuchen. Personenbezogene Daten sind alle Daten, mit denen Sie persönlich identifiziert werden können. Ausführliche Informationen zum Thema Datenschutz entnehmen Sie unserer unter diesem Text aufgeführten Datenschutzerklärung.
                    </p>

                    <h3 className="text-xl font-semibold mb-2 text-slate-700">Datenerfassung auf dieser Website</h3>
                    <h4 className="text-lg font-medium mb-1 text-slate-700">Wer ist verantwortlich für die Datenerfassung auf dieser Website?</h4>
                    <p className="mb-4 leading-relaxed">
                        Die Datenverarbeitung auf dieser Website erfolgt durch den Websitebetreiber. Dessen Kontaktdaten können Sie dem Impressum dieser Website entnehmen.
                    </p>

                    <h4 className="text-lg font-medium mb-1 text-slate-700">Wie erfassen wir Ihre Daten?</h4>
                    <p className="mb-4 leading-relaxed">
                        Ihre Daten werden zum einen dadurch erhoben, dass Sie uns diese mitteilen. Hierbei kann es sich z. B. um Daten handeln, die Sie in ein konventionelles Formular oder bei der Account-Erstellung eingeben.
                    </p>
                    <p className="mb-4 leading-relaxed">
                        Andere Daten werden automatisch oder nach Ihrer Einwilligung beim Besuch der Website durch unsere IT-Systeme erfasst. Das sind vor allem technische Daten (z. B. Internetbrowser, Betriebssystem oder Uhrzeit des Seitenaufrufs). Die Erfassung dieser Daten erfolgt automatisch, sobald Sie diese Website betreten.
                    </p>

                    <h4 className="text-lg font-medium mb-1 text-slate-700">Wofür nutzen wir Ihre Daten?</h4>
                    <p className="mb-4 leading-relaxed">
                        Ein Teil der Daten wird erhoben, um eine fehlerfreie Bereitstellung der Website zu gewährleisten. Andere Daten können zur Abwicklung von Verträgen und zur Bereitstellung der SaaS-Dienste von ImmoControlPro360 genutzt werden.
                    </p>

                    <h4 className="text-lg font-medium mb-1 text-slate-700">Welche Rechte haben Sie bezüglich Ihrer Daten?</h4>
                    <p className="mb-6 leading-relaxed">
                        Sie haben jederzeit das Recht, unentgeltlich Auskunft über Herkunft, Empfänger und Zweck Ihrer gespeicherten personenbezogenen Daten zu erhalten. Sie haben außerdem ein Recht, die Berichtigung oder Löschung dieser Daten zu verlangen. Wenn Sie eine Einwilligung zur Datenverarbeitung erteilt haben, können Sie diese Einwilligung jederzeit für die Zukunft widerrufen. Außerdem haben Sie das Recht, unter bestimmten Umständen die Einschränkung der Verarbeitung Ihrer personenbezogenen Daten zu verlangen. Des Weiteren steht Ihnen ein Beschwerderecht bei der zuständigen Aufsichtsbehörde zu.
                    </p>

                    <h2 className="text-2xl font-bold mb-4 mt-8 text-slate-800">2. Hosting und Content Delivery Networks (CDN)</h2>
                    <h3 className="text-xl font-semibold mb-2 text-slate-700">Externes Hosting</h3>
                    <p className="mb-4 leading-relaxed">
                        Diese Website wird bei einem externen Dienstleister gehostet (Hostinger). Die personenbezogenen Daten, die auf dieser Website erfasst werden, werden auf den Servern des Hosters gespeichert. Davor handelt es sich v. a. um IP-Adressen, Kontaktanfragen, Meta- und Kommunikationsdaten, Webseitenzugriffe und sonstige Daten, die über eine Website generiert werden.
                    </p>
                    <p className="mb-6 leading-relaxed">
                        Der Einsatz des Hosters erfolgt zum Zwecke der Vertragserfüllung gegenüber unseren potenziellen und bestehenden Kunden (Art. 6 Abs. 1 lit. b DSGVO) und im Interesse einer sicheren, schnellen und effizienten Bereitstellung unseres Online-Angebots durch einen professionellen Anbieter (Art. 6 Abs. 1 lit. f DSGVO). Unser Hoster wird Ihre Daten nur insoweit verarbeiten, wie dies zur Erfüllung seiner Leistungspflichten erforderlich ist und unsere Weisungen in Bezug auf diese Daten befolgen.
                    </p>

                    <h2 className="text-2xl font-bold mb-4 mt-8 text-slate-800">3. Allgemeine Hinweise und Pflichtinformationen</h2>
                    <h3 className="text-xl font-semibold mb-2 text-slate-700">Datenschutz</h3>
                    <p className="mb-4 leading-relaxed">
                        Die Betreiber dieser Seiten nehmen den Schutz Ihrer persönlichen Daten sehr ernst. Wir behandeln Ihre personenbezogenen Daten vertraulich und entsprechend den gesetzlichen Datenschutzvorschriften sowie dieser Datenschutzerklärung.
                    </p>
                    <p className="mb-4 leading-relaxed">
                        Wenn Sie diese Website benutzen, werden verschiedene personenbezogene Daten erhoben. Personenbezogene Daten sind Daten, mit denen Sie persönlich identifiziert werden können. Die vorliegende Datenschutzerklärung erläutert, welche Daten wir erheben und wofür wir sie nutzen. Sie erläutert auch, wie und zu welchem Zweck das geschieht.
                    </p>
                    <p className="mb-4 leading-relaxed">
                        Wir weisen darauf hin, dass die Datenübertragung im Internet (z. B. bei der Kommunikation per E-Mail) Sicherheitslücken aufweisen kann. Ein lückenloser Schutz der Daten vor dem Zugriff durch Dritte ist nicht möglich.
                    </p>

                    <h3 className="text-xl font-semibold mb-2 text-slate-700">Hinweis zur verantwortlichen Stelle</h3>
                    <p className="mb-4 leading-relaxed">
                        Die verantwortliche Stelle für die Datenverarbeitung auf dieser Website ist:
                    </p>
                    <p className="mb-4 leading-relaxed font-semibold">
                        Johann Lutz<br />
                        Obere Himmelsbergstraße 137<br />
                        66482 Zweibrücken
                    </p>
                    <p className="mb-6 leading-relaxed">
                        E-Mail: support@immocontrolpro360.de
                    </p>

                    <h3 className="text-xl font-semibold mb-2 text-slate-700">Widerruf Ihrer Einwilligung zur Datenverarbeitung</h3>
                    <p className="mb-6 leading-relaxed">
                        Viele Datenverarbeitungsvorgänge sind nur mit Ihrer ausdrücklichen Einwilligung möglich. Sie können eine bereits erteilte Einwilligung jederzeit widerrufen. Dazu reicht eine formlose Mitteilung per E-Mail an uns. Die Rechtmäßigkeit der bis zum Widerruf erfolgten Datenverarbeitung bleibt vom Widerruf unberührt.
                    </p>

                    <h3 className="text-xl font-semibold mb-2 text-slate-700">Beschwerderecht bei der zuständigen Aufsichtsbehörde</h3>
                    <p className="mb-6 leading-relaxed">
                        Im Falle von Verstößen gegen die DSGVO steht den Betroffenen ein Beschwerderecht bei einer Aufsichtsbehörde, insbesondere in dem Mitgliedstaat ihres üblichen Aufenthaltsorts, ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes zu. Das Beschwerderecht besteht unbeschadet anderweitiger verwaltungsrechtlicher oder gerichtlicher Rechtsbehelfe.
                    </p>

                    <h3 className="text-xl font-semibold mb-2 text-slate-700">Recht auf Datenübertragbarkeit</h3>
                    <p className="mb-6 leading-relaxed">
                        Sie haben das Recht, Daten, die wir auf Grundlage Ihrer Einwilligung oder in Erfüllung eines Vertrags automatisiert verarbeiten, an sich oder an einen Dritten in einem gängigen, maschinenlesbaren Format aushändigen zu lassen. Sofern Sie die direkte Übertragung der Daten an einen anderen Verantwortlichen verlangen, erfolgt dies nur, soweit es technisch machbar ist.
                    </p>

                    <h3 className="text-xl font-semibold mb-2 text-slate-700">SSL- bzw. TLS-Verschlüsselung</h3>
                    <p className="mb-6 leading-relaxed">
                        Diese Seite nutzt aus Sicherheitsgründen und zum Schutz der Übertragung vertraulicher Inhalte, wie zum Beispiel Bestellungen oder Anfragen, die Sie an uns als Seitenbetreiber senden, eine SSL- bzw. TLS-Verschlüsselung. Eine verschlüsselte Verbindung erkennen Sie daran, dass die Adresszeile des Browsers von „http://“ auf „https://“ wechselt und an dem Schloss-Symbol in Ihrer Browserzeile.
                    </p>

                    <h3 className="text-xl font-semibold mb-2 text-slate-700">Auskunft, Löschung und Berichtigung</h3>
                    <p className="mb-6 leading-relaxed">
                        Sie haben im Rahmen der geltenden gesetzlichen Bestimmungen jederzeit das Recht auf unentgeltliche Auskunft über Ihre gespeicherten personenbezogenen Daten, deren Herkunft und Empfänger und den Zweck der Datenverarbeitung und ggf. ein Recht auf Berichtigung oder Löschung dieser Daten. Hierzu sowie zu weiteren Fragen zum Thema personenbezogene Daten können Sie sich jederzeit unter der im Impressum angegebenen Adresse an uns wenden.
                    </p>

                    <h2 className="text-2xl font-bold mb-4 mt-8 text-slate-800">4. Datenerfassung auf dieser Website</h2>
                    <h3 className="text-xl font-semibold mb-2 text-slate-700">Server-Log-Dateien</h3>
                    <p className="mb-4 leading-relaxed">
                        Der Provider der Seiten erhebt und speichert automatisch Informationen in sogenannten Server-Log-Dateien, die Ihr Browser automatisch an uns übermittelt. Dies sind:
                    </p>
                    <ul className="list-disc list-inside mb-4 space-y-2 leading-relaxed text-slate-600">
                        <li>Browsertyp und Browserversion</li>
                        <li>Verwendetes Betriebssystem</li>
                        <li>Referrer URL</li>
                        <li>Hostname des zugreifenden Rechners</li>
                        <li>Uhrzeit der Serveranfrage</li>
                        <li>IP-Adresse</li>
                    </ul>
                    <p className="mb-6 leading-relaxed">
                        Eine Zusammenführung dieser Daten mit anderen Datenquellen wird nicht vorgenommen. Die Erfassung dieser Daten erfolgt auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. Der Websitebetreiber hat ein berechtigtes Interesse an der technisch fehlerfreien Darstellung und der Optimierung seiner Website – hierzu müssen die Server-Log-Files erfasst werden.
                    </p>

                    <h3 className="text-xl font-semibold mb-2 text-slate-700">Kontaktformular</h3>
                    <p className="mb-4 leading-relaxed">
                        Wenn Sie uns per Kontaktformular Anfragen zukommen lassen, werden Ihre Angaben aus dem Anfrageformular inklusive der von Ihnen dort angegebenen Kontaktdaten zwecks Bearbeitung der Anfrage und für den Fall von Anschlussfragen bei uns gespeichert. Diese Daten geben wir nicht ohne Ihre Einwilligung weiter.
                    </p>
                    <p className="mb-6 leading-relaxed">
                        Die Verarbeitung dieser Daten erfolgt auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO, sofern Ihre Anfrage mit der Erfüllung eines Vertrags zusammenhängt oder zur Durchführung vorvertraglicher Maßnahmen erforderlich ist. In allen übrigen Fällen beruht die Verarbeitung auf unserem berechtigten Interesse an der effektiven Bearbeitung der an uns gerichteten Anfragen (Art. 6 Abs. 1 lit. f DSGVO) oder auf Ihrer Einwilligung (Art. 6 Abs. 1 lit. a DSGVO) falls diese abgefragt wurde.
                    </p>

                    <h2 className="text-2xl font-bold mb-4 mt-8 text-slate-800">5. Zahlungsdienstleister (Payment-Abwicklung)</h2>
                    <h3 className="text-xl font-semibold mb-2 text-slate-700">Stripe</h3>
                    <p className="mb-4 leading-relaxed">
                        Wir binden auf unserer Website Dienste des Zahlungsabwicklers Stripe ein. Anbieter für Kunden innerhalb der EU ist die Stripe Payments Europe Ltd., 1 Grand Canal Street Lower, Grand Canal Dock, Dublin, Irland (nachfolgend „Stripe“).
                    </p>
                    <p className="mb-4 leading-relaxed">
                        Bei Zahlung über eine Zahlungsart von Stripe werden die von Ihnen eingegebenen Zahlungsdaten (z. B. Kreditkartennummer, IBAN, Betrag, Währung, Name, E-Mail-Adresse und Rechnungsanschrift) an Stripe übermittelt. Die Weitergabe Ihrer Daten an Stripe erfolgt zum Zwecke der Zahlungsabwicklung und auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung).
                    </p>
                    <p className="mb-6 leading-relaxed">
                        Details zum Datenschutz bei Stripe finden Sie unter folgendem Link: <a href="https://stripe.com/de/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-semibold">https://stripe.com/de/privacy</a>.
                    </p>
                </>
            )
        },
        agb: {
            title: 'Allgemeine Geschäftsbedingungen (AGB)',
            body: (
                <>
                    <p className="text-sm text-slate-400 mb-6">Stand: Mai 2026</p>

                    <h2 className="text-xl font-bold mb-4 mt-6 text-slate-800">1. Geltungsbereich und Anbieter</h2>
                    <p className="mb-4 leading-relaxed">
                        Diese Allgemeinen Geschäftsbedingungen (nachfolgend „AGB“) gelten für alle Verträge über die Nutzung der Software-as-a-Service (SaaS)-Plattform „ImmoControlPro360“ zwischen Johann Lutz, Obere Himmelsbergstraße 137, 66482 Zweibrücken (nachfolgend „Anbieter“ oder „wir“) und den Kunden (nachfolgend „Nutzer“ oder „Sie“).
                    </p>
                    <p className="mb-6 leading-relaxed">
                        Abweichende, entgegenstehende oder ergänzende Allgemeine Geschäftsbedingungen des Nutzers werden nicht Vertragsbestandteil, es sei denn, ihrer Geltung wird ausdrücklich schriftlich zugestimmt.
                    </p>

                    <h2 className="text-xl font-bold mb-4 text-slate-800">2. Vertragsgegenstand und Leistungsumfang</h2>
                    <p className="mb-4 leading-relaxed">
                        Vertragsgegenstand ist die entgeltliche oder im Rahmen einer Testphase unentgeltliche Bereitstellung der Software ImmoControlPro360 zur Nutzung über das Internet als SaaS (Software-as-a-Service) zur Immobilienverwaltung, Renditeberechnung und Mieterkommunikation.
                    </p>
                    <p className="mb-4 leading-relaxed">
                        Der Anbieter strebt eine durchschnittliche jährliche Verfügbarkeit der Plattform von 95 % an. Ausgenommen hiervon sind Zeiten notwendiger Wartungsarbeiten, die nach Möglichkeit im Voraus angekündigt werden, sowie Ausfälle aufgrund von Umständen, die außerhalb des Einflussbereichs des Anbieters liegen (z. B. höhere Gewalt, Störungen von Drittanbietern oder Netzbetreibern).
                    </p>
                    <p className="mb-6 leading-relaxed">
                        Der Anbieter behält sich das Recht vor, die bereitgestellten Dienste und Funktionen stetig zu erweitern, dem technischen Fortschritt anzupassen oder zu modifizieren, um die Systemsicherheit zu wahren oder gesetzliche Anforderungen zu erfüllen.
                    </p>

                    <h2 className="text-xl font-bold mb-4 text-slate-800">3. Registrierung, Testphase und Vertragsschluss</h2>
                    <p className="mb-4 leading-relaxed">
                        Die Nutzung der Plattform erfordert die Registrierung und das Anlegen eines Nutzerkontos. Der Nutzer versichert, dass alle bei der Registrierung gemachten Angaben wahr und vollständig sind.
                    </p>
                    <p className="mb-4 leading-relaxed">
                        Nach der Registrierung steht dem Nutzer ein kostenloser Testzeitraum von 10 Tagen zur Verfügung. Dieser Testzeitraum endet automatisch und erfordert keine Kündigung.
                    </p>
                    <p className="mb-6 leading-relaxed">
                        Ein kostenpflichtiges Abonnement kommt zustande, indem der Nutzer einen entsprechenden kostenpflichtigen Tarif auswählt, seine Zahlungsdaten hinterlegt und den Bestellvorgang abschließt. Der Vertrag kommt mit der Freischaltung des entsprechenden Dienstes oder durch Zusendung einer Auftragsbestätigung per E-Mail zustande.
                    </p>

                    <h2 className="text-xl font-bold mb-4 text-slate-800">4. Zahlungsbedingungen und Zahlungsverzug</h2>
                    <p className="mb-4 leading-relaxed">
                        Die Preise für die Nutzung von ImmoControlPro360 richten sich nach dem gewählten Tarif und verstehen sich inklusive der gesetzlichen Mehrwertsteuer.
                    </p>
                    <p className="mb-4 leading-relaxed">
                        Die Abrechnung erfolgt im Voraus je nach gewähltem Abrechnungszeitraum (monatlich oder jährlich). Die Zahlungsabwicklung erfolgt über den externen Zahlungsdienstleister Stripe.
                    </p>
                    <p className="mb-6 leading-relaxed">
                        Gerät der Nutzer mit der Zahlung um einen Betrag in Höhe von zwei Monatsgebühren in Verzug, ist der Anbieter berechtigt, den Zugang zum System vorübergehend zu sperren. Die Pflicht zur Zahlung der vereinbarten Entgelte bleibt von der Sperrung unberührt.
                    </p>

                    <h2 className="text-xl font-bold mb-4 text-slate-800">5. Ausschluss von Beratung und Haftungsausschluss</h2>
                    <p className="mb-4 leading-relaxed font-semibold text-slate-900">
                        WICHTIGER HINWEIS: Die auf der Plattform bereitgestellten Rechner (z. B. Renditerechner, Zinsrechner, Cashflow-Kalkulatoren) sowie alle Dokumentenvorlagen (z. B. Mietvertragsvorlagen, Nebenkostenabrechnungsmuster) dienen ausschließlich Informationszwecken. Sie stellen keine Rechtsberatung, Steuerberatung oder Finanzberatung dar.
                    </p>
                    <p className="mb-4 leading-relaxed">
                        Der Nutzer ist selbst verpflichtet, alle Ergebnisse, Berechnungen und Verträge auf Richtigkeit, Aktualität und rechtliche Zulässigkeit hin zu prüfen oder durch qualifizierte Dritte (Rechtsanwälte, Steuerberater) prüfen zu lassen.
                    </p>
                    <p className="mb-6 leading-relaxed">
                        Wir übernehmen keine Haftung für die Richtigkeit, Aktualität, Vollständigkeit oder juristische Fehlerfreiheit der Rechnersysteme oder der bereitgestellten Vorlagen. Die Verwendung geschieht auf eigenes Risiko des Nutzers.
                    </p>

                    <h2 className="text-xl font-bold mb-4 text-slate-800">6. Haftungsbegrenzung</h2>
                    <p className="mb-4 leading-relaxed">
                        Der Anbieter haftet unbeschränkt für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit, die auf einer vorsätzlichen oder fahrlässigen Pflichtverletzung beruhen, sowie bei Vorsatz, grober Fahrlässigkeit und Arglist.
                    </p>
                    <p className="mb-4 leading-relaxed">
                        Bei leichter Fahrlässigkeit haftet der Anbieter nur bei der Verletzung wesentlicher Vertragspflichten (Kardinalpflichten), d.h. solcher Pflichten, deren Erfüllung die ordnungsgemäße Durchführung des Vertrages überhaupt erst ermöglicht und auf deren Einhaltung der Vertragspartner regelmäßig vertrauen darf. In diesem Fall ist die Haftung auf den vertragstypischen, vorhersehbaren Schaden begrenzt.
                    </p>
                    <p className="mb-4 leading-relaxed">
                        Die Haftung für leicht fahrlässigen Datenverlust oder sonstige Mangelfolgeschäden sowie entgangenen Gewinn ist ausgeschlossen.
                    </p>
                    <p className="mb-6 leading-relaxed">
                        Die vorstehenden Haftungsbeschränkungen gelten auch zugunsten der Erfüllungsgehilfen und Mitarbeiter des Anbieters.
                    </p>

                    <h2 className="text-xl font-bold mb-4 text-slate-800">7. Pflichten des Nutzers</h2>
                    <p className="mb-4 leading-relaxed">
                        Der Nutzer ist verpflichtet, seine Zugangsdaten (insbesondere das Passwort) geheim zu halten und vor dem Zugriff durch unbefugte Dritte zu schützen.
                    </p>
                    <p className="mb-6 leading-relaxed">
                        Der Nutzer trägt die alleinige Verantwortung für die von ihm eingestellten Inhalte und Daten (z. B. Mieterdaten, Verträge, Anhänge). Er stellt sicher, dass diese Daten nicht gegen gesetzliche Vorschriften (insbesondere Urheberrechte, Markenrechte und Datenschutzrechte) verstoßen.
                    </p>

                    <h2 className="text-xl font-bold mb-4 text-slate-800">8. Laufzeit und Kündigung</h2>
                    <p className="mb-4 leading-relaxed">
                        Die Laufzeit des Vertrages richtet sich nach dem gewählten Tarif.
                    </p>
                    <p className="mb-4 leading-relaxed">
                        Monatsabonnements können jederzeit mit einer Frist von zwei Wochen zum Ende des Abrechnungsmonats gekündigt werden. Jahresabonnements können mit einer Frist von vier Wochen zum Ende des Abrechnungsjahres gekündigt werden. Erfolgt keine Kündigung, verlängern sich die Abonnements automatisch um die jeweils gleiche Laufzeit.
                    </p>
                    <p className="mb-6 leading-relaxed">
                        Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt beiden Parteien unberührt.
                    </p>

                    <h2 className="text-xl font-bold mb-4 text-slate-800">9. Schlussbestimmungen</h2>
                    <p className="mb-4 leading-relaxed">
                        Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts.
                    </p>
                    <p className="mb-6 leading-relaxed">
                        Sofern es sich bei dem Nutzer um einen Kaufmann, eine juristische Person des öffentlichen Rechts oder ein öffentlich-rechtliches Sondervermögen handelt, ist der Gerichtsstand für alle Streitigkeiten aus oder im Zusammenhang mit diesem Vertrag Zweibrücken.
                    </p>
                </>
            )
        }
    };

    const data = content[type] || { title: 'Seite nicht gefunden', body: 'Inhalt nicht verfügbar.' };

    return (
        <MainLayout>
            <section className="py-20 md:py-32 bg-white">
                <div className="container max-w-3xl mx-auto px-4">
                    <h1 className="text-3xl md:text-4xl font-bold mb-8 text-slate-900">{data.title}</h1>
                    <div className="prose prose-slate max-w-none text-slate-600">
                        {data.body || <p>Hier folgt der Text für {data.title}...</p>}
                    </div>
                </div>
            </section>
        </MainLayout>
    );
};

export default Legal;
