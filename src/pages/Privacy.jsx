import React from 'react';

// Fassungsdatum dieser Erklärung – bei jeder inhaltlichen Änderung von Hand anpassen
// (früher wurde hier das Tagesdatum erzeugt und täuschte eine tagesaktuelle Fassung vor).
const VERSION_DATE = '27. November 2026';

const WEBSITE_URL = 'https://immocontrol360.de';
const IMPRESSUM_URL = `${WEBSITE_URL}/impressum`;
const PRIVACY_URL = `${WEBSITE_URL}/datenschutz`;

const h2Style = { fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' };
const listStyle = { paddingLeft: '20px', marginBottom: '15px' };
const linkStyle = { color: 'var(--primary-color)', textDecoration: 'underline' };

const ExternalLink = ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" style={linkStyle}>{children}</a>
);

const Privacy = () => {
    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px', fontFamily: 'sans-serif', lineHeight: '1.6', color: 'var(--text-primary)' }}>
            <h1 style={{ fontSize: '2rem', marginBottom: '20px', fontWeight: 'bold' }}>Datenschutzerklärung</h1>
            <p>Stand: {VERSION_DATE}</p>

            <h2 style={h2Style}>1. Datenschutz auf einen Blick</h2>
            <p>Wir nehmen den Schutz Ihrer persönlichen Daten sehr ernst. Wir behandeln Ihre personenbezogenen Daten vertraulich und entsprechend der gesetzlichen Datenschutzvorschriften sowie dieser Datenschutzerklärung.</p>
            <p>Diese Hinweise betreffen die Anwendung ImmoControlpro360 (Web-App und Android-App). Ergänzende Informationen enthält unsere ausführliche Datenschutzerklärung unter <ExternalLink href={PRIVACY_URL}>immocontrol360.de/datenschutz</ExternalLink>.</p>

            <h2 style={h2Style}>2. Betreiber und Kontakt</h2>
            <p>Name, Anschrift und Kontaktdaten des Betreibers der Anwendung finden Sie im Impressum unter <ExternalLink href={IMPRESSUM_URL}>immocontrol360.de/impressum</ExternalLink>. Bei Fragen zum Datenschutz können Sie sich jederzeit über diese Kontaktdaten an uns wenden.</p>

            <h2 style={h2Style}>3. Eingesetzte Dienstleister</h2>
            <p>Für den Betrieb der Anwendung setzen wir folgende Dienstleister ein:</p>
            <ul style={listStyle}>
                <li><strong>Supabase</strong> (Datenbank, Benutzerkonten und Anmeldung, Dateiablage): Dort werden Ihre Kontodaten sowie die Daten gespeichert, die Sie in der Anwendung erfassen (z.B. Objekt-, Mieter- und Vertragsdaten, Dokumente).</li>
                <li><strong>Hostinger</strong> (Hosting): Die Web-App wird von Servern des Hosting-Anbieters Hostinger ausgeliefert. Dabei wird technisch bedingt Ihre IP-Adresse verarbeitet.</li>
                <li><strong>Google Fonts</strong> (Google): Beim Aufruf der Anwendung sowie beim Drucken und Erstellen von Dokumenten werden Schriftarten (insbesondere „Open Sans“ für Briefvorlagen und Dokumente) von Servern von Google geladen. Dabei wird Ihre IP-Adresse an Google übermittelt.</li>
                <li><strong>cdnjs</strong> (Cloudflare): Für die Erstellung von PDF-Dateien lädt die Anwendung eine Programmbibliothek über den Dienst cdnjs. Dabei wird Ihre IP-Adresse an Cloudflare übermittelt.</li>
                <li><strong>Anmeldung mit Google</strong> (optional): Wenn Sie sich mit Ihrem Google-Konto anmelden, übermittelt Google die für die Anmeldung nötigen Profildaten (insbesondere Name und E-Mail-Adresse).</li>
                <li><strong>Firebase Cloud Messaging</strong> (Google, nur Android-App): Wenn Sie Push-Benachrichtigungen erlauben, wird für Ihr Gerät eine Kennung (Push-Token) erzeugt, gespeichert und zum Zustellen der Benachrichtigungen verwendet.</li>
            </ul>

            <h2 style={h2Style}>4. Cloud-Dienste (Google Drive / Microsoft OneDrive)</h2>
            <p>Unsere Anwendung bietet die Möglichkeit, sich mit Ihrem Google Drive oder Microsoft OneDrive Account zu verbinden. Diese Funktion dient ausschließlich dazu, Dokumente (z.B. Rechnungen, Mietverträge) in Ihrem eigenen Cloud-Speicher strukturiert abzulegen.</p>
            <ul style={listStyle}>
                <li><strong>Welche Daten werden abgerufen?</strong> Wir greifen auf Ihre E-Mail-Adresse zu, um die Verbindung im System visuell zuzuordnen. Wir fordern Schreibrechte (und Leserechte für von uns erstellte Ordner) an, um Dateien in Ihrem Cloud-Speicher ablegen zu können.</li>
                <li><strong>Was passiert mit den Daten?</strong> Wir speichern lediglich die Authentifizierungs-Token (Access Token & Refresh Token) sicher in unserer Datenbank, um den automatisierten Upload zu ermöglichen. Wir lesen oder analysieren keine bestehenden Dateien auf Ihrem Cloud-Speicher, die nicht von unserer Anwendung erstellt wurden.</li>
                <li><strong>Weitergabe:</strong> Es findet keine Weitergabe Ihrer Cloud-Daten oder Tokens an Dritte statt.</li>
            </ul>

            <h2 style={h2Style}>5. Zahlungsdienstleister (Stripe)</h2>
            <p>Für die Abwicklung von kostenpflichtigen Abonnements binden wir den Dienst des Zahlungsabwicklers Stripe (Stripe Payments Europe Ltd., 1 Grand Canal Street Lower, Grand Canal Dock, Dublin, Irland) ein. Die von Ihnen im Checkout-Prozess eingegebenen Zahlungsdaten werden zum Zwecke der Abrechnung und Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO) sicher an Stripe übermittelt.</p>

            <h2 style={h2Style}>6. Datenerfassung auf dieser Website</h2>
            <p>Die Datenerfassung auf dieser Website erfolgt durch den Websitebetreiber. Die Daten, die Sie uns übermitteln (z.B. bei der Registrierung), werden ausschließlich für die Bereitstellung unserer Software-Dienstleistung genutzt.</p>

            <h2 style={h2Style}>7. Ihre Rechte</h2>
            <p>Sie haben nach der Datenschutz-Grundverordnung insbesondere das Recht auf Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung Ihrer Daten, auf Datenübertragbarkeit, auf Widerspruch sowie auf Widerruf einer erteilten Einwilligung. Außerdem steht Ihnen ein Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde zu. Einzelheiten finden Sie in unserer ausführlichen Datenschutzerklärung unter <ExternalLink href={PRIVACY_URL}>immocontrol360.de/datenschutz</ExternalLink>.</p>
        </div>
    );
};

export default Privacy;
