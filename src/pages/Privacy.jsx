import React from 'react';

const Privacy = () => {
    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px', fontFamily: 'sans-serif', lineHeight: '1.6', color: 'var(--text-color)' }}>
            <h1 style={{ fontSize: '2rem', marginBottom: '20px', fontWeight: 'bold' }}>Datenschutzerklärung</h1>
            <p>Stand: {new Date().toLocaleDateString('de-DE')}</p>

            <h2 style={{ fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' }}>1. Datenschutz auf einen Blick</h2>
            <p>Wir nehmen den Schutz Ihrer persönlichen Daten sehr ernst. Wir behandeln Ihre personenbezogenen Daten vertraulich und entsprechend der gesetzlichen Datenschutzvorschriften sowie dieser Datenschutzerklärung.</p>

            <h2 style={{ fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' }}>2. Cloud-Dienste (Google Drive / Microsoft OneDrive)</h2>
            <p>Unsere Anwendung bietet die Möglichkeit, sich mit Ihrem Google Drive oder Microsoft OneDrive Account zu verbinden. Diese Funktion dient ausschließlich dazu, Dokumente (z.B. Rechnungen, Mietverträge) in Ihrem eigenen Cloud-Speicher strukturiert abzulegen.</p>
            <ul style={{ paddingLeft: '20px', marginBottom: '15px' }}>
                <li><strong>Welche Daten werden abgerufen?</strong> Wir greifen auf Ihre E-Mail-Adresse zu, um die Verbindung im System visuell zuzuordnen. Wir fordern Schreibrechte (und Leserechte für von uns erstellte Ordner) an, um Dateien in Ihrem Cloud-Speicher ablegen zu können.</li>
                <li><strong>Was passiert mit den Daten?</strong> Wir speichern lediglich die Authentifizierungs-Token (Access Token & Refresh Token) sicher in unserer Datenbank, um den automatisierten Upload zu ermöglichen. Wir lesen oder analysieren keine bestehenden Dateien auf Ihrem Cloud-Speicher, die nicht von unserer Anwendung erstellt wurden.</li>
                <li><strong>Weitergabe:</strong> Es findet keine Weitergabe Ihrer Cloud-Daten oder Tokens an Dritte statt.</li>
            </ul>

            <h2 style={{ fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' }}>3. Zahlungsdienstleister (Stripe)</h2>
            <p>Für die Abwicklung von kostenpflichtigen Abonnements binden wir den Dienst des Zahlungsabwicklers Stripe (Stripe Payments Europe Ltd., 1 Grand Canal Street Lower, Grand Canal Dock, Dublin, Irland) ein. Die von Ihnen im Checkout-Prozess eingegebenen Zahlungsdaten werden zum Zwecke der Abrechnung und Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO) sicher an Stripe übermittelt.</p>

            <h2 style={{ fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' }}>4. Datenerfassung auf dieser Website</h2>
            <p>Die Datenerfassung auf dieser Website erfolgt durch den Websitebetreiber. Die Daten, die Sie uns übermitteln (z.B. bei der Registrierung), werden ausschließlich für die Bereitstellung unserer Software-Dienstleistung genutzt.</p>
            
            <h2 style={{ fontSize: '1.5rem', marginTop: '30px', marginBottom: '15px' }}>5. Kontakt</h2>
            <p>Bei Fragen zum Datenschutz wenden Sie sich bitte an den Support oder Betreiber der Anwendung.</p>
        </div>
    );
};

export default Privacy;
