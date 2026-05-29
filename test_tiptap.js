import { JSDOM } from 'jsdom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Mention from '@tiptap/extension-mention';
import Image from '@tiptap/extension-image';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Node } from '@tiptap/core';

console.log('1. Setting up JSDOM...');
// JSDOM setup for Node environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
});
console.log('2. JSDOM created. Setting up globals...');
global.window = dom.window;
global.document = dom.window.document;
if (!global.navigator) {
  global.navigator = dom.window.navigator;
}
global.HTMLElement = dom.window.HTMLElement;
console.log('3. Globals set up.');

const createLayoutNode = (name, className, allowedContent) => Node.create({
    name,
    group: 'block',
    content: allowedContent,
    defining: true,
    addAttributes() {
        return {
            class: {
                default: className,
                parseHTML: element => {
                    const cls = element.getAttribute('class') || '';
                    return cls.includes(className) ? className : null;
                },
                renderHTML: attributes => {
                    return { class: `layout-div ${attributes.class || className}` };
                }
            },
            style: {
                default: null,
                parseHTML: element => element.getAttribute('style'),
                renderHTML: attributes => {
                    if (!attributes.style) return {};
                    return { style: attributes.style };
                }
            }
        };
    },
    parseHTML() {
        return [
            {
                tag: 'div',
                getAttrs: node => node.classList.contains(className) && {
                    class: node.getAttribute('class'),
                    style: node.getAttribute('style')
                }
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ['div', HTMLAttributes, 0];
    }
});

const LetterPage = createLayoutNode('letterPage', 'letter-page', 'block+');
const LetterSender = createLayoutNode('letterSender', 'letter-sender', 'inline*');
const LetterHeaderRow = createLayoutNode('letterHeaderRow', 'letter-header-row', 'block+');
const LetterRecipient = createLayoutNode('letterRecipient', 'letter-recipient', 'inline*');
const LetterDate = createLayoutNode('letterDate', 'letter-date', 'inline*');
const LetterSubject = createLayoutNode('letterSubject', 'letter-subject', 'inline*');
const LetterObject = createLayoutNode('letterObject', 'letter-object', 'inline*');
const LetterBody = createLayoutNode('letterBody', 'letter-body', 'block+');
const LetterFooter = createLayoutNode('letterFooter', 'letter-footer', 'block+');
const FooterCol = createLayoutNode('footerCol', 'footer-col', 'inline*');

const htmlContent = `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Zahlungserinnerung zu offenen Mietforderungen</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem Mietbeginn ein Mietverhältnis über die oben bezeichnete Mietwohnung. Bezüglich der offenen Posten besteht aktuell ein Zahlungsrückstand.</p></div></div>`;

console.log('4. Initializing Editor...');
try {
    const editor = new Editor({
        extensions: [
            StarterKit.configure({
                horizontalRule: false,
            }),
            LetterPage,
            LetterSender,
            LetterHeaderRow,
            LetterRecipient,
            LetterDate,
            LetterSubject,
            LetterObject,
            LetterBody,
            LetterFooter,
            FooterCol,
            Underline,
            TextAlign.configure({
                types: ['heading', 'paragraph'],
                alignments: ['left', 'center', 'right', 'justify'],
            }),
            TextStyle,
            Color,
            Mention.extend({
                draggable: true,
            }).configure({
                HTMLAttributes: {
                    class: 'variable-chip',
                    contenteditable: 'false',
                },
                renderLabel({ node }) {
                    return `${node.attrs.label ?? node.attrs.id}`;
                },
            }),
            HorizontalRule.extend({
                draggable: true,
                selectable: true,
            }).configure({
                HTMLAttributes: {
                    class: 'editor-hr',
                }
            }),
            Image.configure({
                inline: true,
                HTMLAttributes: {
                    class: 'editor-image',
                    style: 'max-height: 240px; object-fit: contain; margin: 10px 0; display: block;'
                }
            })
        ],
        content: htmlContent,
    });

    console.log('SUCCESS: Content parsed successfully!');
    console.log('Document JSON:', JSON.stringify(editor.getJSON(), null, 2));
    process.exit(0);
} catch (error) {
    console.error('ERROR during editor creation or parsing:', error);
    process.exit(1);
}
