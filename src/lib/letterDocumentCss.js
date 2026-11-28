// Gemeinsame Stile der Briefseite (DIN 5008 / A4) für Vorlagen-Editor, Live-Vorschau,
// Druckfenster und Rechnungen.
//
// - Seitengeometrie: EINE Quelle in letterPage.css. index.css bindet die Datei per @import ein
//   (Editor und im Hauptdokument gerenderte Dokumente), hier wird sie als Text geladen (?inline),
//   damit eigenständige Dokumente (Druckfenster, Rechnungs-HTML) exakt dieselben Regeln erhalten.
// - Inhalte (Listen, Tabellen, Markierungen): LETTER_CONTENT_CSS – nur Editor, Live-Vorschau und
//   Druckfenster des Vorlagen-Editors (bewusst NICHT global, sonst änderten sich die Tabellen der
//   Nebenkostenabrechnung).

import letterPageCss from './letterPage.css?inline';

export const LETTER_PAGE_CSS = letterPageCss;

// Selektorliste an Kommas auf oberster Ebene trennen (nicht in :has(...) oder [attr="a,b"])
const splitSelectorList = (selectorList) => {
    const parts = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < selectorList.length; i++) {
        const c = selectorList[i];
        if (quote) {
            if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === '(' || c === '[') {
            depth++;
        } else if (c === ')' || c === ']') {
            depth--;
        } else if (c === ',' && depth === 0) {
            parts.push(selectorList.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(selectorList.slice(start));
    return parts.map(s => s.trim()).filter(Boolean);
};

// Begrenzt flache CSS-Regeln (ohne @-Regeln) auf einen Container, z. B. '.ic-invoice-doc'.
// Auch für minifiziertes CSS (Produktions-Build) geeignet.
export const scopeLetterCss = (css, scope) => String(css || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map(block => {
        const open = block.indexOf('{');
        if (open < 0) return '';
        const selectors = block.slice(0, open).replace(/\s+/g, ' ').trim();
        const declarations = block.slice(open + 1).replace(/\s+/g, ' ').trim();
        if (!selectors || selectors.startsWith('@') || !declarations) return '';
        return `${splitSelectorList(selectors).map(s => `${scope} ${s}`).join(', ')} { ${declarations} }`;
    })
    .filter(Boolean)
    .join('\n');

// Inhalts-Stile (Editor, Live-Vorschau UND Druckfenster des Vorlagen-Editors)
export const LETTER_CONTENT_CSS = `
    .letter-page ul, .letter-page ol { padding-left: 1.5em; margin: 0 0 1em 0; }
    .letter-page ul { list-style-type: disc; }
    .letter-page ol { list-style-type: decimal; }
    .letter-page li > p { margin-bottom: 0.25em !important; min-height: 0 !important; }
    .letter-page img.editor-image { max-width: 100%; }
    .letter-page table:not(.invoice-table) { width: 100%; border-collapse: collapse; margin: 15px 0; background-color: transparent !important; border: 1px solid #cbd5e1 !important; }
    .letter-page table:not(.invoice-table) th { background-color: #f1f5f9 !important; color: #0f172a !important; font-weight: bold; border: 1px solid #cbd5e1 !important; padding: 8px 12px !important; }
    .letter-page table:not(.invoice-table) td { border: 1px solid #cbd5e1 !important; padding: 8px 12px !important; color: #334155 !important; background-color: transparent !important; }
    .letter-page .invoice-table { width: 100%; border-collapse: collapse; margin-bottom: 8mm; background-color: transparent !important; border: none !important; }
    .letter-page .invoice-table th { border-bottom: 2px solid #000 !important; border-top: none !important; border-left: none !important; border-right: none !important; text-align: left; padding: 8px 0 !important; font-weight: 700; background-color: transparent !important; color: #000000 !important; }
    .letter-page .invoice-table td { border-bottom: 1px solid #ddd !important; border-top: none !important; border-left: none !important; border-right: none !important; padding: 8px 0 !important; color: #000000 !important; background-color: transparent !important; }
    .letter-page .totals { display: flex; justify-content: flex-end; margin-bottom: 20mm; }
    .letter-page .totals-box { width: 80mm; }
    .letter-page .t-row { display: flex; justify-content: space-between; margin-bottom: 4px; color: #000000; }
    .letter-page .t-row.final { border-top: 2px solid #000; padding-top: 4px; margin-top: 4px; font-weight: 700; font-size: 11pt; color: #000000; }
    .letter-page .tpl-block { margin: 0 0 1em 0; }
    .letter-page .tpl-example-block { outline: 1px dashed #ca8a04; outline-offset: 2px; }
    .letter-page .tpl-missing { color: #b91c1c !important; background-color: #fee2e2 !important; font-weight: 600; border-radius: 2px; }
    .letter-page .tpl-example { background-color: #fef9c3; border-bottom: 1px dotted #ca8a04; }
`;

// Textsatz wie im Editor: TipTap/ProseMirror setzt white-space: break-spaces, bricht lange Wörter
// um und schaltet Ligaturen ab. Live-Vorschau und Druckfenster erhalten dieselben Regeln, damit
// Zeilen (und damit Seiten) an denselben Stellen umbrechen. Aufgelöste Platzhalter (Text und
// Tabellen) verhalten sich wie die nicht editierbaren Platzhalter-Chips im Editor (white-space: normal).
export const editorTextFlowCss = (containerSelector) => `
    ${containerSelector} { word-wrap: break-word; overflow-wrap: break-word; white-space: pre-wrap; white-space: break-spaces; -webkit-font-variant-ligatures: none; font-variant-ligatures: none; font-feature-settings: "liga" 0; }
    ${containerSelector} .tpl-var, ${containerSelector} .tpl-block { white-space: normal; }
`;
