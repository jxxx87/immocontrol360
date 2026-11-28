// Unit-Tests: Kopf/Fuß des Client-PDF-Generators ohne bzw. mit gespeicherter Vorlage.
// Ohne DOM: Das Druckfenster ist ein Stub, der das geschriebene HTML sammelt.
import { describe, it, expect } from 'vitest';
import { generateClientPdf } from './pdfGenerator';
import { getColumnsForPreset } from './reportConfigs';

const makeWindow = () => {
    const win = {
        closed: false,
        html: '',
        focus() {},
        print() {},
    };
    win.document = {
        open() { win.html = ''; },
        write(h) { win.html += h; },
        close() {},
        getElementById: () => null,
        querySelector: () => null,
        images: [],
    };
    return win;
};

const ROWS = [{ adresse: 'Musterweg 1', kaufpreis: 1000 }];

const exportWith = (template) => {
    const win = makeWindow();
    const opened = generateClientPdf({
        reportType: 'immobilien',
        data: ROWS,
        selectedColumns: ['adresse', 'kaufpreis'],
        orientation: 'portrait',
        portfolioName: 'Portfolio A',
        template,
        autoPrint: false,
        targetWindow: win,
    });
    expect(opened).toBe(true);
    const header = win.html.split('<div class="header">')[1].split('<div class="content">')[0];
    const footer = win.html.split('<div class="footer">')[1];
    return { header, footer };
};

describe('generateClientPdf – Kopf ohne gespeicherte Vorlage', () => {
    it('druckt das Standard-Layout des Vorlagen-Editors (Portfolio und Stichtag in eigenen Zeilen)', () => {
        for (const template of [null, { isDefault: true, elements: [], orientationByReport: {} }]) {
            const { header, footer } = exportWith(template);
            expect(header).toContain('>Immobilienübersicht</div>');
            expect(header).toContain('>Portfolio A</div>');
            expect(header).toContain('>Stichtag: ');
            expect(header).not.toContain('· Stichtag');
            // Trennlinie des Standard-Layouts (#cccccc), nicht mehr in der Akzentfarbe
            expect(header).toContain('border-top:1px solid #cccccc');
            expect(footer).toContain('data-page-number="1"');
            expect(footer).toContain('>Stichtag: ');
        }
    });

    it('lässt eine gespeicherte Vorlage ohne Elemente leer (kein Ersatz-Kopf)', () => {
        const { header, footer } = exportWith({ isDefault: false, elements: [], orientationByReport: {} });
        expect(header).not.toContain('Immobilienübersicht');
        expect(header).not.toContain('Stichtag');
        expect(footer).not.toContain('data-page-number');
    });

    it('nutzt die Elemente einer gespeicherten Vorlage', () => {
        const { header } = exportWith({
            isDefault: false,
            orientationByReport: { global: 'portrait' },
            elements: [{ id: 't', type: 'freetext', zone: 'header', x: 15, y: 18, w: 80, h: 6, visible: true, text: 'Eigener Kopf' }],
        });
        expect(header).toContain('>Eigener Kopf</div>');
        expect(header).not.toContain('Stichtag');
    });
});

describe('reportConfigs', () => {
    it('Buchhaltung „Detailliert“ enthält keine stets leere Spalte „Rechnung“', () => {
        expect(getColumnsForPreset('buchhaltung', 'detail')).toEqual(['datum', 'empfaenger', 'verwendungszweck', 'betrag', 'kategorie', 'immobilie']);
    });
});
