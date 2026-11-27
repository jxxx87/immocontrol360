import React from 'react';
import { Link } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout';
import { BRAND_NAME } from './siteConfig';

// Eigene 404-Seite statt stiller Weiterleitung auf die Startseite (W1b-12).
// Die SPA liefert technisch weiterhin HTTP 200 – "noindex" verhindert Soft-404-Einträge.
const NotFound = () => {
    return (
        <MainLayout>
            <title>{`Seite nicht gefunden | ${BRAND_NAME}`}</title>
            <meta name="robots" content="noindex" />
            <section className="pt-40 pb-24 bg-slate-50">
                <div className="container max-w-2xl mx-auto text-center">
                    <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-4">Fehler 404</p>
                    <h1 className="text-3xl md:text-5xl font-bold mb-6">Diese Seite gibt es nicht.</h1>
                    <p className="text-lg text-slate-600 mb-10">
                        Vielleicht hat sich ein Tippfehler eingeschlichen oder der Link ist veraltet.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link to="/" className="btn-primary">Zur Startseite</Link>
                        <Link to="/preise" className="btn-secondary">Preise ansehen</Link>
                        <Link to="/faq" className="btn-secondary">Häufige Fragen</Link>
                    </div>
                </div>
            </section>
        </MainLayout>
    );
};

export default NotFound;
