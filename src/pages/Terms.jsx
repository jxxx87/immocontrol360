import React from 'react';

const Terms = () => {
    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px', fontFamily: 'sans-serif', lineHeight: '1.6', color: 'var(--text-color)' }}>
            <h1 style={{ fontSize: '2rem', marginBottom: '20px', fontWeight: 'bold' }}>Nutzungsbedingungen</h1>
            <p>Stand: {new Date().toLocaleDateString('de-DE')}</p>

            <h2 style={{ fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' }}>1. Geltungsbereich</h2>
            <p>Diese Nutzungsbedingungen gelten für die Nutzung der Software ImmoControlpro360. Durch die Nutzung der Anwendung stimmen Sie diesen Bedingungen zu.</p>

            <h2 style={{ fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' }}>2. Leistungen der Anwendung</h2>
            <p>ImmoControlpro360 stellt Funktionen zur Verwaltung von Immobilienportfolios, Finanzkennzahlen und Dokumenten bereit. Die Anwendung ermöglicht es optional, Dokumente automatisiert in einen externen Cloud-Speicher (Google Drive, Microsoft OneDrive) des Nutzers zu übertragen.</p>

            <h2 style={{ fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' }}>3. Cloud-Integration (Drittanbieter)</h2>
            <p>Wenn Sie Ihren Google Drive- oder Microsoft OneDrive-Account verknüpfen, erklären Sie sich damit einverstanden, dass ImmoControlpro360 in Ihrem Namen auf diesen Dienst zugreift, um Ordner zu erstellen und Dateien hochzuladen. Sie sind selbst dafür verantwortlich, dass ausreichend Speicherplatz in Ihrem Cloud-Konto zur Verfügung steht und die dort geltenden Nutzungsbedingungen des Drittanbieters (Google/Microsoft) eingehalten werden.</p>
            <p>Wir übernehmen keine Haftung für Datenverluste, die durch Fehler bei Drittanbietern entstehen.</p>

            <h2 style={{ fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' }}>4. Ausschluss von Beratung und Berechnungen</h2>
            <p><strong>WICHTIGER HINWEIS:</strong> Die auf der Plattform bereitgestellten Rechner (Renditerechner, Zinsrechner, Cashflow-Kalkulatoren etc.) sowie alle bereitgestellten Dokumentvorlagen dienen ausschließlich zu Informationszwecken. Sie stellen keine Rechts-, Steuer- oder Finanzberatung dar. Der Nutzer ist verpflichtet, Berechnungen und Verträge vor Verwendung selbstständig auf Richtigkeit und rechtliche Konformität zu prüfen.</p>

            <h2 style={{ fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' }}>5. Haftungsausschluss</h2>
            <p>Die Anwendung wird "wie besehen" bereitgestellt. Wir übernehmen keine Gewähr für die ständige Verfügbarkeit oder Fehlerfreiheit der Software. Die Haftung für leichte Fahrlässigkeit, Datenverlust oder entgangenen Gewinn ist ausgeschlossen, soweit gesetzlich zulässig. Die Nutzung erfolgt auf eigene Gefahr.</p>

            <h2 style={{ fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' }}>6. Änderungen der Bedingungen</h2>
            <p>Wir behalten uns das Recht vor, diese Nutzungsbedingungen jederzeit zu ändern. Änderungen werden in der Anwendung kommuniziert.</p>
        </div>
    );
};

export default Terms;
