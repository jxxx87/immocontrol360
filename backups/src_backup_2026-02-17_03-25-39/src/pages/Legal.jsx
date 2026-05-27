import React from 'react';
import MainLayout from '../layouts/MainLayout';

const Legal = ({ type }) => {
    const content = {
        impressum: {
            title: 'Impressum',
            body: (
                <>
                    <h2 className="text-xl font-bold mb-4">Angaben gemäß § 5 TMG</h2>
                    <p className="mb-4">
                        ImmoControlPro360<br />
                        Musterstraße 1<br />
                        12345 Musterstadt
                    </p>
                    <h2 className="text-xl font-bold mb-4">Kontakt</h2>
                    <p className="mb-4">
                        Telefon: +49 123 456789<br />
                        E-Mail: support@immocontrolpro360.de
                    </p>
                    <p className="text-sm text-slate-500">
                        Dies ist eine Demo-Seite. Ersetzen Sie diese Angaben durch Ihre echten Daten.
                    </p>
                </>
            )
        },
        datenschutz: {
            title: 'Datenschutzerklärung',
            body: (
                <>
                    <h2 className="text-xl font-bold mb-4">1. Datenschutz auf einen Blick</h2>
                    <p className="mb-4">
                        Die folgenden Hinweise geben einen einfachen Überblick darüber, was mit Ihren personenbezogenen Daten passiert, wenn Sie unsere Website besuchen.
                    </p>
                    <h2 className="text-xl font-bold mb-4">2. Allgemeine Hinweise und Pflichtinformationen</h2>
                    <p className="mb-4">
                        Wir nehmen den Schutz Ihrer persönlichen Daten sehr ernst. Wir behandeln Ihre personenbezogenen Daten vertraulich und entsprechend der gesetzlichen Datenschutzvorschriften sowie dieser Datenschutzerklärung.
                    </p>
                </>
            )
        },
        agb: {
            title: 'Allgemeine Geschäftsbedingungen'
        }
    };

    const data = content[type] || { title: 'Seite nicht gefunden', body: 'Inhalt nicht verfügbar.' };

    return (
        <MainLayout>
            <section className="py-20 md:py-32 bg-white">
                <div className="container max-w-3xl mx-auto">
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
