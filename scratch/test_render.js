import { JSDOM } from 'jsdom';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

// 1. JSDOM initialisieren, um Browser-Umgebung für TipTap zu simulieren
const jsdom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost'
});
globalThis.window = jsdom.window;
globalThis.document = jsdom.window.document;

// Sicheres Überschreiben von schreibgeschützten globalen Objekten wie navigator
Object.defineProperty(globalThis, 'navigator', {
    value: jsdom.window.navigator,
    configurable: true,
    writable: true
});

// Mocks für global und document APIs, die TipTap und andere Bibliotheken benötigen
globalThis.window.getSelection = () => ({
    addRange: () => {},
    removeAllRanges: () => {},
    getRangeAt: () => ({}),
});

// 2. React.useContext abfangen (Hook Hijack) für alle Kontexte (Auth, Portfolio, ViewMode)
const originalUseContext = React.useContext;
React.useContext = (context) => {
    return {
        user: { id: 'test-user-id', email: 'test@example.com' },
        portfolios: [
            { id: 'global', name: 'Standard (alle Portfolios)' },
            { id: 'test-portfolio-id', name: 'Test Portfolio', company_name: 'Test GmbH' }
        ],
        selectedPortfolioID: 'global',
        loading: false,
        roleLoading: false,
        isInvestor: true,
        isTenant: false,
        isMobile: false, // Für useViewMode()
        refreshPortfolios: () => {}
    };
};

// 3. DocumentTemplates laden und rendern
import DocumentTemplates from '../src/pages/settings/DocumentTemplates.jsx';

async function testRender() {
    console.log('Starte Render-Test für DocumentTemplates...');
    try {
        const html = ReactDOMServer.renderToString(
            React.createElement(DocumentTemplates)
        );
        console.log('Render-Test ERFOLGREICH! HTML-Länge:', html.length);
        console.log('Auszug aus HTML:', html.substring(0, 300) + '...');
    } catch (error) {
        console.error('Render-Test FEHLGESCHLAGEN mit folgendem Fehler:');
        console.error(error);
        process.exit(1);
    }
}

testRender();
