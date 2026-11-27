import React from 'react';

// Fassungsdatum dieser Bedingungen – bei jeder inhaltlichen Änderung von Hand anpassen
// (früher wurde hier das Tagesdatum erzeugt und täuschte eine tagesaktuelle Fassung vor).
const VERSION_DATE = '27. November 2026';

const WEBSITE_URL = 'https://immocontrol360.de';
const IMPRESSUM_URL = `${WEBSITE_URL}/impressum`;
const AGB_URL = `${WEBSITE_URL}/agb`;

const h2Style = { fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' };
const paragraphStyle = { marginBottom: '12px' };
const linkStyle = { color: 'var(--primary-color)', textDecoration: 'underline' };

const ExternalLink = ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" style={linkStyle}>{children}</a>
);

const Terms = () => {
    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px', fontFamily: 'sans-serif', lineHeight: '1.6', color: 'var(--text-primary)' }}>
            <h1 style={{ fontSize: '2rem', marginBottom: '20px', fontWeight: 'bold' }}>Nutzungsbedingungen</h1>
            <p>Stand: {VERSION_DATE}</p>

            <h2 style={h2Style}>1. Geltungsbereich</h2>
            <p style={paragraphStyle}>Diese Nutzungsbedingungen gelten für die Nutzung der Software ImmoControlpro360. Durch die Nutzung der Anwendung stimmen Sie diesen Bedingungen zu.</p>
            <p style={paragraphStyle}>Anbieter der Software ist der im Impressum genannte Betreiber (<ExternalLink href={IMPRESSUM_URL}>immocontrol360.de/impressum</ExternalLink>). Unsere Allgemeinen Geschäftsbedingungen finden Sie unter <ExternalLink href={AGB_URL}>immocontrol360.de/agb</ExternalLink>.</p>

            <h2 style={h2Style}>2. Leistungen der Anwendung</h2>
            <p>ImmoControlpro360 stellt Funktionen zur Verwaltung von Immobilienportfolios, Finanzkennzahlen und Dokumenten bereit. Die Anwendung ermöglicht es optional, Dokumente automatisiert in einen externen Cloud-Speicher (Google Drive, Microsoft OneDrive) des Nutzers zu übertragen.</p>

            <h2 style={h2Style}>3. Cloud-Integration (Drittanbieter)</h2>
            <p>Wenn Sie Ihren Google Drive- oder Microsoft OneDrive-Account verknüpfen, erklären Sie sich damit einverstanden, dass ImmoControlpro360 in Ihrem Namen auf diesen Dienst zugreift, um Ordner zu erstellen und Dateien hochzuladen. Sie sind selbst dafür verantwortlich, dass ausreichend Speicherplatz in Ihrem Cloud-Konto zur Verfügung steht und die dort geltenden Nutzungsbedingungen des Drittanbieters (Google/Microsoft) eingehalten werden.</p>
            <p>Wir übernehmen keine Haftung für Datenverluste, die durch Fehler bei Drittanbietern entstehen.</p>

            <h2 style={h2Style}>4. Ausschluss von Beratung und Berechnungen</h2>
            <p><strong>WICHTIGER HINWEIS:</strong> Die auf der Plattform bereitgestellten Rechner (Renditerechner, Zinsrechner, Cashflow-Kalkulatoren etc.) sowie alle bereitgestellten Dokumentvorlagen dienen ausschließlich zu Informationszwecken. Sie stellen keine Rechts-, Steuer- oder Finanzberatung dar. Der Nutzer ist verpflichtet, Berechnungen und Verträge vor Verwendung selbstständig auf Richtigkeit und rechtliche Konformität zu prüfen.</p>

            {/* Wortgleich mit § 6 der AGB auf immocontrol360.de/agb (Haftungsstaffelung statt pauschalem Ausschluss) */}
            <h2 style={h2Style}>5. Haftungsbegrenzung</h2>
            <p style={paragraphStyle}>Der Anbieter haftet unbeschränkt für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit, die auf einer vorsätzlichen oder fahrlässigen Pflichtverletzung beruhen, sowie bei Vorsatz, grober Fahrlässigkeit und Arglist.</p>
            <p style={paragraphStyle}>Bei leichter Fahrlässigkeit haftet der Anbieter nur bei der Verletzung wesentlicher Vertragspflichten (Kardinalpflichten), d.h. solcher Pflichten, deren Erfüllung die ordnungsgemäße Durchführung des Vertrages überhaupt erst ermöglicht und auf deren Einhaltung der Vertragspartner regelmäßig vertrauen darf. In diesem Fall ist die Haftung auf den vertragstypischen, vorhersehbaren Schaden begrenzt.</p>
            <p style={paragraphStyle}>Die Haftung für leicht fahrlässigen Datenverlust oder sonstige Mangelfolgeschäden sowie entgangenen Gewinn ist ausgeschlossen.</p>
            <p style={paragraphStyle}>Die vorstehenden Haftungsbeschränkungen gelten auch zugunsten der Erfüllungsgehilfen und Mitarbeiter des Anbieters.</p>

            <h2 style={h2Style}>6. Änderungen der Bedingungen</h2>
            <p>Wir behalten uns das Recht vor, diese Nutzungsbedingungen jederzeit zu ändern. Änderungen werden in der Anwendung kommuniziert.</p>
        </div>
    );
};

export default Terms;
