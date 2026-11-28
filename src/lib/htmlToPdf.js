// HTML -> PDF mit den gebündelten Bibliotheken html2canvas und jsPDF (package.json).
//
// Ersetzt html2pdf.js, das bisher zur Laufzeit von cdnjs nachgeladen wurde (Fremdskript ohne
// Integritätsprüfung, IP-Übermittlung an Cloudflare, offline/in der App nicht verfügbar).
// Ablauf und Seitenaufteilung entsprechen html2pdf.js 0.10.x, damit die erzeugten PDFs
// gleich aussehen:
//   1. Quelle in einen unsichtbaren Container im App-Dokument klonen (Breite = Innenbreite der Seite)
//   2. Seitenumbrüche: Abstandshalter vor/nach Elementen (CSS break-before/-after/-inside,
//      Klasse .html2pdf__page-break, Selektoren aus pagebreak.before/after/avoid)
//   3. html2canvas rendert den Container, das Bild wird in Seitenhöhe zerschnitten (jsPDF)
// Aufruf wie bisher: const html2pdf = await loadHtml2Pdf();
//                    await html2pdf().set({ ... }).from(element).save();

const LOAD_ERROR = 'Die PDF-Komponente konnte nicht geladen werden. Bitte laden Sie die Seite neu und versuchen Sie es erneut.';

// Papierformate in pt (wie jsPDF)
const PAGE_FORMATS_PT = {
    a3: [841.89, 1190.55],
    a4: [595.28, 841.89],
    a5: [419.53, 595.28],
    letter: [612, 792],
    legal: [612, 1008]
};

const UNIT_FACTORS = { pt: 1, mm: 72 / 25.4, cm: 72 / 2.54, in: 72, px: 72 / 96, pc: 12, em: 12, ex: 6 };

const DEFAULT_OPTIONS = Object.freeze({
    filename: 'file.pdf',
    margin: [0, 0, 0, 0],
    image: { type: 'jpeg', quality: 0.95 },
    enableLinks: true,
    html2canvas: {},
    jsPDF: {},
    pagebreak: { mode: ['css', 'legacy'], before: [], after: [], avoid: [] }
});

let libsLoading = null;

const loadLibraries = () => {
    if (!libsLoading) {
        libsLoading = Promise.all([import('html2canvas'), import('jspdf')])
            .then(([h2c, jspdf]) => ({
                html2canvas: h2c.default || h2c,
                JsPDF: jspdf.jsPDF || jspdf.default
            }))
            .catch(() => {
                libsLoading = null;
                throw new Error(LOAD_ERROR);
            });
    }
    return libsLoading;
};

// Seitengröße in der gewählten Einheit (entspricht jsPDF.getPageSize aus html2pdf.js)
export const getPageSize = ({ unit = 'mm', format = 'a4', orientation = 'portrait' } = {}) => {
    const k = UNIT_FACTORS[unit];
    if (!k) throw new Error(`Ungültige Einheit für das PDF: ${unit}`);
    let width;
    let height;
    if (Array.isArray(format) && format.length === 2) {
        [width, height] = format.map(Number);
    } else {
        const pt = PAGE_FORMATS_PT[String(format).toLowerCase()];
        if (!pt) throw new Error(`Ungültiges Papierformat für das PDF: ${format}`);
        width = pt[0] / k;
        height = pt[1] / k;
    }
    const o = String(orientation || 'p').toLowerCase();
    if ((o === 'p' || o === 'portrait') && width > height) [width, height] = [height, width];
    if ((o === 'l' || o === 'landscape') && height > width) [width, height] = [height, width];
    return { width, height, unit, k };
};

// Rand: Zahl, [vertikal, horizontal] oder [oben, links, unten, rechts] (Reihenfolge wie html2pdf.js)
export const normalizeMargin = (margin) => {
    if (typeof margin === 'number') return [margin, margin, margin, margin];
    if (Array.isArray(margin)) {
        const m = margin.map(Number);
        if (m.length === 2) return [m[0], m[1], m[0], m[1]];
        if (m.length === 4) return m;
    }
    throw new Error('Ungültige Randangabe für das PDF.');
};

const toPx = (val, k) => Math.floor(((val * k) / 72) * 96);
const unitConvert = (val, k) => (val * 72) / 96 / k;

export const computeInnerPage = (pageSize, margin) => {
    const inner = {
        width: pageSize.width - margin[1] - margin[3],
        height: pageSize.height - margin[0] - margin[2]
    };
    inner.px = { width: toPx(inner.width, pageSize.k), height: toPx(inner.height, pageSize.k) };
    inner.ratio = inner.height / inner.width;
    return inner;
};

// Tiefe Kopie ohne Skripte; Canvas-Inhalte und Formularwerte bleiben erhalten
const cloneNode = (node) => {
    const clone = node.nodeType === 3 ? document.createTextNode(node.nodeValue) : node.cloneNode(false);
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1 || child.nodeName !== 'SCRIPT') clone.appendChild(cloneNode(child));
    }
    if (node.nodeType === 1) {
        if (node.nodeName === 'CANVAS') {
            clone.width = node.width;
            clone.height = node.height;
            clone.getContext('2d').drawImage(node, 0, 0);
        } else if (node.nodeName === 'TEXTAREA' || node.nodeName === 'SELECT') {
            clone.value = node.value;
        }
    }
    return clone;
};

const createElement = (tagName, { className = '', style = {} } = {}) => {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    Object.keys(style).forEach(key => { el.style[key] = style[key]; });
    return el;
};

const BREAK_VALUES = ['always', 'page', 'left', 'right'];
const AVOID_VALUES = ['avoid', 'avoid-page'];

// Abstandshalter einfügen, damit Elemente an Seitengrenzen umbrechen (Logik wie html2pdf.js)
const applyPageBreaks = (root, pxPageHeight, pagebreak) => {
    const modes = [].concat(pagebreak?.mode || []);
    const mode = {
        avoidAll: modes.includes('avoid-all'),
        css: modes.includes('css'),
        legacy: modes.includes('legacy')
    };
    const select = {};
    ['before', 'after', 'avoid'].forEach(key => {
        const selectors = mode.avoidAll && key === 'avoid' ? [] : [].concat(pagebreak?.[key] || []);
        select[key] = selectors.length ? Array.from(root.querySelectorAll(selectors.join(', '))) : [];
    });
    const legacyEls = Array.from(root.querySelectorAll('.html2pdf__page-break'));

    Array.from(root.querySelectorAll('*')).forEach(el => {
        let rules = { before: false, after: mode.legacy && legacyEls.includes(el), avoid: mode.avoidAll };
        if (mode.css) {
            const style = window.getComputedStyle(el);
            rules = {
                before: rules.before || BREAK_VALUES.includes(style.breakBefore || style.pageBreakBefore),
                after: rules.after || BREAK_VALUES.includes(style.breakAfter || style.pageBreakAfter),
                avoid: rules.avoid || AVOID_VALUES.includes(style.breakInside || style.pageBreakInside)
            };
        }
        Object.keys(rules).forEach(key => { rules[key] = rules[key] || select[key].includes(el); });

        const rect = el.getBoundingClientRect();
        if (rules.avoid && !rules.before) {
            const startPage = Math.floor(rect.top / pxPageHeight);
            const endPage = Math.floor(rect.bottom / pxPageHeight);
            const nPages = Math.abs(rect.bottom - rect.top) / pxPageHeight;
            if (endPage !== startPage && nPages <= 1) rules.before = true;
        }
        if (rules.before) {
            const pad = createElement('div', { style: { display: 'block', height: `${pxPageHeight - (rect.top % pxPageHeight)}px` } });
            el.parentNode.insertBefore(pad, el);
        }
        if (rules.after) {
            const pad = createElement('div', { style: { display: 'block', height: `${pxPageHeight - (rect.bottom % pxPageHeight)}px` } });
            el.parentNode.insertBefore(pad, el.nextSibling);
        }
    });
};

const SAFE_LINK_RE = /^(https?:|mailto:|tel:)/i;

// Verweise (a href) als klickbare Bereiche im PDF übernehmen (nur http(s), mailto, tel)
const collectLinks = (container, pageSize, inner, margin) => {
    const k = pageSize.k;
    const cRect = container.getBoundingClientRect();
    const containerLeft = unitConvert(cRect.left, k);
    const containerTop = unitConvert(cRect.top, k);
    const links = [];
    container.querySelectorAll('a[href]').forEach(link => {
        const url = link.href;
        if (!SAFE_LINK_RE.test(url)) return;
        Array.from(link.getClientRects()).forEach(r => {
            const left = unitConvert(r.left, k) - containerLeft;
            const top = unitConvert(r.top, k) - containerTop;
            links.push({
                page: Math.floor(top / inner.height) + 1,
                top: margin[0] + (top % inner.height),
                left: margin[1] + left,
                width: unitConvert(r.width, k),
                height: unitConvert(r.height, k),
                url
            });
        });
    });
    return links;
};

const renderToPdf = async (libs, opt, src) => {
    if (!src) throw new Error('Das PDF konnte nicht erzeugt werden (kein Inhalt).');
    const margin = normalizeMargin(opt.margin);
    const pageSize = getPageSize(opt.jsPDF || {});
    const inner = computeInnerPage(pageSize, margin);

    let source = src;
    if (typeof src === 'string') {
        source = createElement('div');
        source.innerHTML = src;
        source.querySelectorAll('script').forEach(s => s.remove());
    }

    // 1. Unsichtbarer Container im App-Dokument (wie html2pdf.js)
    const overlay = createElement('div', {
        className: 'html2pdf__overlay',
        style: {
            position: 'fixed', overflow: 'hidden', zIndex: 1000,
            left: 0, right: 0, bottom: 0, top: 0,
            backgroundColor: 'rgba(0,0,0,0.8)', opacity: 0
        }
    });
    const container = createElement('div', {
        className: 'html2pdf__container',
        style: {
            position: 'absolute', width: `${inner.width}${pageSize.unit}`,
            left: 0, right: 0, top: 0, height: 'auto', margin: 'auto',
            backgroundColor: 'white'
        }
    });
    container.appendChild(cloneNode(source));
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    let canvas;
    let links = [];
    try {
        // 2. Seitenumbrüche und Verweise
        applyPageBreaks(container, inner.px.height, opt.pagebreak || DEFAULT_OPTIONS.pagebreak);
        if (opt.enableLinks) links = collectLinks(container, pageSize, inner, margin);
        // 3. Rendern
        const h2cOptions = { ...(opt.html2canvas || {}) };
        delete h2cOptions.onrendered;
        canvas = await libs.html2canvas(container, h2cOptions);
    } finally {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    // 4. Bild in Seiten zerschneiden
    const imageType = String(opt.image?.type || 'jpeg').toLowerCase();
    const quality = opt.image?.quality ?? 0.95;
    const pxFullHeight = canvas.height;
    const pxPageHeight = Math.floor(canvas.width * inner.ratio);
    if (!(pxFullHeight > 0) || !(pxPageHeight > 0)) throw new Error('Das PDF konnte nicht erzeugt werden (leerer Inhalt).');
    const nPages = Math.ceil(pxFullHeight / pxPageHeight);
    let pageHeight = inner.height;

    const pageCanvas = document.createElement('canvas');
    const pageCtx = pageCanvas.getContext('2d');
    pageCanvas.width = canvas.width;
    pageCanvas.height = pxPageHeight;

    const pdf = new libs.JsPDF(opt.jsPDF || {});
    for (let page = 0; page < nPages; page++) {
        if (page === nPages - 1 && pxFullHeight % pxPageHeight !== 0) {
            pageCanvas.height = pxFullHeight % pxPageHeight;
            pageHeight = (pageCanvas.height * inner.width) / pageCanvas.width;
        }
        const w = pageCanvas.width;
        const h = pageCanvas.height;
        pageCtx.fillStyle = 'white';
        pageCtx.fillRect(0, 0, w, h);
        pageCtx.drawImage(canvas, 0, page * pxPageHeight, w, h, 0, 0, w, h);
        if (page) pdf.addPage();
        const imgData = pageCanvas.toDataURL(`image/${imageType}`, quality);
        pdf.addImage(imgData, imageType.toUpperCase(), margin[1], margin[0], inner.width, pageHeight);
    }

    if (links.length) {
        links.forEach(l => {
            if (l.page < 1 || l.page > nPages) return;
            pdf.setPage(l.page);
            pdf.link(l.left, l.top, l.width, l.height, { url: l.url });
        });
        pdf.setPage(nPages);
    }
    return pdf;
};

const createWorker = (libs) => {
    const opt = {
        ...DEFAULT_OPTIONS,
        image: { ...DEFAULT_OPTIONS.image },
        pagebreak: { ...DEFAULT_OPTIONS.pagebreak }
    };
    let src = null;
    let pdfPromise = null;
    const toPdf = () => {
        if (!pdfPromise) pdfPromise = renderToPdf(libs, opt, src);
        return pdfPromise;
    };
    const worker = {
        // Optionen werden je Schlüssel ersetzt (nicht zusammengeführt) – wie html2pdf.js
        set(options) {
            if (options && typeof options === 'object') {
                Object.keys(options).forEach(key => { opt[key] = options[key]; });
                pdfPromise = null;
            }
            return worker;
        },
        from(source) {
            src = source;
            pdfPromise = null;
            return worker;
        },
        toPdf,
        async save(filename) {
            const pdf = await toPdf();
            pdf.save(filename || opt.filename);
        },
        async outputPdf(type = 'arraybuffer', options) {
            const pdf = await toPdf();
            return pdf.output(type, options);
        },
        output(type = 'arraybuffer', options) {
            return worker.outputPdf(type, options);
        }
    };
    return worker;
};

// Liefert eine Fabrik mit der Aufrufform von html2pdf.js: html2pdf().set(opt).from(el).save()
export const loadHtml2Pdf = async () => {
    const libs = await loadLibraries();
    return () => createWorker(libs);
};
