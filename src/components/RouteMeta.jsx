import React from 'react';
import { useLocation } from 'react-router-dom';
import { BRAND_NAME } from './siteConfig';

// Rückfall-Titel je Route (W1b-11). Die Seiten setzen Titel, Description, Canonical und robots
// selbst als React-19-Metadaten (<title>, <meta>, <link> im Seiten-JSX). React fügt den <title>
// einer Seite VOR bereits vorhandenen Titeln ein – der Seitentitel gewinnt also immer; dieser
// Rückfall greift nur auf Seiten ohne eigenen Titel.
// Wichtig: React übernimmt beim ersten <title> das statische <title> aus index.html und entfernt
// es beim Seitenwechsel wieder. Ohne diesen Rückfall hätte eine Seite ohne eigenen Titel danach
// gar keinen Titel mehr (Tab zeigt nur die Adresse).
const TITLES = {
    '/': `${BRAND_NAME} – Immobilienverwaltung für private Investoren`,
    '/preise': `Preise | ${BRAND_NAME}`,
    '/funktionen': `Funktionen | ${BRAND_NAME} – Immobilienverwaltung für Investoren`,
    '/faq': `FAQ | ${BRAND_NAME} – Antworten für Investoren`,
    '/landing': `Für Investoren: Skalieren ohne Chaos | ${BRAND_NAME}`,
    '/investor': `Für Investoren: Skalieren ohne Chaos | ${BRAND_NAME}`,
    '/impressum': `Impressum | ${BRAND_NAME}`,
    '/datenschutz': `Datenschutzerklärung | ${BRAND_NAME}`,
    '/agb': `Allgemeine Geschäftsbedingungen | ${BRAND_NAME}`,
    '/abo-starten': `Kostenlos testen | ${BRAND_NAME}`,
    '/checkout': `Kostenlos testen | ${BRAND_NAME}`,
    '/register-trial': `Kostenlos testen | ${BRAND_NAME}`,
    '/paywall': `Abo abschließen | ${BRAND_NAME}`,
    '/billing/success': `Abrechnung | ${BRAND_NAME}`,
    '/billing/cancel': `Abrechnung | ${BRAND_NAME}`,
    '/login': `Login | ${BRAND_NAME}`,
};

const NOT_FOUND_TITLE = `Seite nicht gefunden | ${BRAND_NAME}`;

const normalizePath = (pathname) => (pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';

const RouteMeta = () => {
    const { pathname } = useLocation();
    const title = TITLES[normalizePath(pathname)] || NOT_FOUND_TITLE;
    return <title>{title}</title>;
};

export default RouteMeta;
