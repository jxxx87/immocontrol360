import{s as N}from"./index-NHzS8ogr.js";import{Q as et}from"./browser-C2xOIgIG.js";import{o as tt}from"./fontFaces-DyasV2Ow.js";const nt={},Ae=e=>String(e).padStart(2,"0"),I=e=>{const n=typeof e=="number"?e:parseFloat(e);return Number.isFinite(n)?n:0},h=e=>Math.round((I(e)+Number.EPSILON)*100)/100,ee=(e=new Date)=>`${e.getFullYear()}-${Ae(e.getMonth()+1)}-${Ae(e.getDate())}`,H=e=>{if(!e)return null;if(e instanceof Date)return isNaN(e.getTime())?null:new Date(e.getFullYear(),e.getMonth(),e.getDate());const n=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(e).trim());if(n){const i=new Date(Number(n[1]),Number(n[2])-1,Number(n[3]));return isNaN(i.getTime())?null:i}const a=new Date(e);return isNaN(a.getTime())?null:new Date(a.getFullYear(),a.getMonth(),a.getDate())},ge=(e,n)=>{const a=new Date(e.getFullYear(),e.getMonth(),e.getDate());return a.setDate(a.getDate()+n),a},Mt=(e,n)=>{const a=new Date(e.getFullYear(),e.getMonth()+n,1),i=new Date(a.getFullYear(),a.getMonth()+1,0).getDate();return a.setDate(Math.min(e.getDate(),i)),a},Ee=(e,n)=>{const a=H(e),i=H(n);if(!a||!i)return 0;const r=Date.UTC(a.getFullYear(),a.getMonth(),a.getDate()),o=Date.UTC(i.getFullYear(),i.getMonth(),i.getDate());return Math.round((o-r)/864e5)},at=e=>{const n=H(e);return n?n.toLocaleDateString("de-DE"):""},Ve=e=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(I(e)),it=e=>{const n=e%19,a=Math.floor(e/100),i=e%100,r=Math.floor(a/4),o=a%4,l=Math.floor((a+8)/25),b=Math.floor((a-l+1)/3),_=(19*n+a-r-b+15)%30,E=Math.floor(i/4),c=i%4,w=(32+2*o+2*E-_-c)%7,V=Math.floor((n+11*_+22*w)/451),m=Math.floor((_+w-7*V+114)/31),G=(_+w-7*V+114)%31+1;return new Date(e,m-1,G)},rt=e=>{const n=e.getFullYear(),a=ee(e),i=it(n),r=[`${n}-01-01`,`${n}-05-01`,`${n}-10-03`,`${n}-12-25`,`${n}-12-26`],o=[-2,1,39,50].map(l=>ee(ge(i,l)));return r.includes(a)||o.includes(a)},dt=e=>{let n=H(e);if(!n)return null;let a=0;for(;(n.getDay()===0||n.getDay()===6||rt(n))&&a<10;)n=ge(n,1),a++;return n},st=(e,n=new Date)=>{const a=dt(e);return a?Math.max(0,Ee(a,n)):0},ot="https://app.immocontrol360.de",lt=()=>{const e=nt?.VITE_PUBLIC_APP_URL;return e&&/^https?:\/\//i.test(e)?e.replace(/\/+$/,""):typeof window<"u"&&!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform())||typeof window>"u"?ot:window.location.origin},gt=e=>`${lt()}/forderung/portal/${encodeURIComponent(e||"")}`,pt=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,mt=(e,n="Die Aktion konnte nicht ausgeführt werden.")=>{const a=String(e?.message||e?.details||(typeof e=="string"?e:"")||"").trim();if(!a)return n;if(/gehört Owner|RLS verhindert/i.test(a))return"Forderungen können derzeit nur vom Eigentümer des Mietvertrags angelegt werden.";if(/invalid input syntax for type (numeric|integer|date)/i.test(a))return"Ein eingegebener Betrag oder ein Datum ist ungültig. Bitte prüfen Sie die Eingaben.";if(/row-level security|permission denied|violates row-level/i.test(a))return"Sie haben keine Berechtigung für diese Aktion.";if(/failed to fetch|network request failed|networkerror/i.test(a))return"Verbindungsfehler. Bitte prüfen Sie Ihre Internetverbindung.";let i=a.replace(/(\d+(?:\.\d+)?)\.2f/g,(r,o)=>Ve(Number(o)));return i=i.replace(pt,"…"),i},p=e=>String(e??"").replace(/[&<>"']/g,n=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n]),ct=new Set(["SCRIPT","IFRAME","FRAME","FRAMESET","OBJECT","EMBED","APPLET","LINK","META","BASE","FORM","INPUT","BUTTON","TEXTAREA","SELECT","OPTION","NOSCRIPT","TEMPLATE","SVG","MATH"]),ut=new Set(["href","src","xlink:href","action","formaction","background","poster","srcset","data","lowsrc","dynsrc","ping","cite","longdesc"]),ht=(e,n)=>{const a=String(e||"").replace(/[\u0000- ]+/g,"").toLowerCase();return a.startsWith("javascript:")||a.startsWith("vbscript:")?!1:a.startsWith("data:")?n==="src"&&a.startsWith("data:image/")&&!a.startsWith("data:image/svg"):!0},bt=e=>{if(!e)return"";if(typeof DOMParser>"u")return String(e).replace(/<script[\s\S]*?<\/script>/gi,"");const n=new DOMParser().parseFromString(`<!DOCTYPE html><html><head></head><body>${e}</body></html>`,"text/html"),a=i=>{Array.from(i.childNodes).forEach(r=>{if(r.nodeType===8){r.remove();return}if(r.nodeType===1){if(ct.has(String(r.tagName).toUpperCase())){r.remove();return}Array.from(r.attributes).forEach(o=>{const l=o.name.toLowerCase();(l.startsWith("on")||l==="srcdoc"||l==="formaction"||ut.has(l)&&!ht(o.value,l)||l==="style"&&/expression\s*\(|javascript:|behavior\s*:/i.test(o.value))&&r.removeAttribute(o.name)}),a(r)}})};return a(n.body),n.body.innerHTML},De="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js",ft=2e4;let C=null;const vt=()=>window.html2pdf?Promise.resolve(window.html2pdf):C||(C=new Promise((e,n)=>{const a=document.querySelector(`script[src="${De}"]`),i=a||document.createElement("script");let r=null;const o=()=>{clearTimeout(r),i.removeEventListener("load",b),i.removeEventListener("error",_)},l=()=>{o(),C=null,!a&&i.parentNode&&i.parentNode.removeChild(i),n(new Error("Die PDF-Komponente konnte nicht geladen werden. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut."))};function b(){o(),window.html2pdf?e(window.html2pdf):l()}function _(){l()}i.addEventListener("load",b),i.addEventListener("error",_),r=setTimeout(()=>{window.html2pdf?b():l()},ft),a||(i.src=De,i.async=!0,i.referrerPolicy="no-referrer",document.head.appendChild(i))}),C),Fe=e=>new Promise(n=>setTimeout(n,e)),s=Ve,X=at,Ne={payment_reminder:{subject:"Zahlungserinnerung zu offenen Mietforderungen",content_html:'<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Zahlungserinnerung zu offenen Mietforderungen</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p><span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Bezüglich der offenen Posten besteht aktuell ein Zahlungsrückstand.</p><p>Trotz Fälligkeit wurde die nachfolgend aufgeführte Forderung nicht vollständig ausgeglichen. Bitte prüfen Sie den Vorgang und gleichen Sie den offenen Betrag aus.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>{vermieter_kontakt}</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>{vermieter_kontakt}</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>'},dunning_1:{subject:"Mahnung wegen Mietrückstand",content_html:'<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Mahnung wegen Mietrückstand</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p><span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>{vermieter_kontakt}</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>{vermieter_kontakt}</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>'},dunning_2:{subject:"Abmahnung und Zahlungsaufforderung wegen Zahlungsverzug",content_html:'<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Abmahnung und Zahlungsaufforderung wegen Zahlungsverzug</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p><span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Aufgrund der Höhe des Rückstands kann zudem die Prüfung einer außerordentlichen fristlosen Kündigung gemäß § 543 Abs. 2 Nr. 3 BGB, hilfsweise einer ordentlichen Kündigung, in Betracht kommen. Für Wohnraummietverhältnisse sind zusätzlich die Regelungen des § 569 BGB zu beachten.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>{vermieter_kontakt}</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>{vermieter_kontakt}</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>'},dunning_final:{subject:"Letzte Zahlungsaufforderung vor weiteren Schritten",content_html:'<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Letzte Zahlungsaufforderung vor weiteren Schritten</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p><span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>{vermieter_kontakt}</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>{vermieter_kontakt}</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>'}},St=e=>e==="Zahlungserinnerung"?1:e==="Abmahnung"||e==="Mahnung"?2:e==="Letzte Zahlungsaufforderung"||e==="dunning_final"?3:0,yt=e=>{const n=Number(e);return e===""||e===null||e===void 0||!Number.isInteger(n)||n<1||n>365?null:n},S=(e,n)=>e.map(a=>(a||"").trim()).filter(Boolean).join(n),Bt=async(e,n,a,i,r,o,l,b,_={})=>{if(!e?.id)throw new Error("Die Forderung ist nicht geladen.");const E=yt(r);if(E===null)throw new Error("Bitte eine gültige Zahlungsfrist angeben (ganze Zahl von 1 bis 365 Tagen).");const c=String(i||"Zahlungserinnerung"),w=[],V=Array.isArray(a)?a:[],{data:m,error:G}=await N.from("profiles").select("first_name, last_name, company, email, phone, bank_name, iban, bic, bank_account_holder").eq("id",e.user_id).maybeSingle();G&&console.warn("Absenderprofil nicht lesbar:",G);const j=e.leases?.units?.properties||{},$=j.portfolio_id;let f=null;if($){const{data:t,error:d}=await N.from("portfolios").select("company_name, email, phone, bank_name, iban, bic").eq("id",$).maybeSingle();d&&console.warn("Portfolio-Daten nicht lesbar:",d),f=t||null}const je=S([m?.first_name,m?.last_name]," "),U=(m?.company||"").trim()||je||(f?.company_name||"").trim();if(!U)throw new Error("Absenderangaben fehlen: Bitte hinterlegen Sie Name bzw. Firma im Profil des Eigentümers oder den Firmennamen im Portfolio, bevor ein Mahnschreiben erzeugt wird.");const $e=S([f?.email||m?.email?`E-Mail: ${f?.email||m?.email}`:"",f?.phone||m?.phone?`Tel.: ${f?.phone||m?.phone}`:""],`
`),B=e.tenants||{},A=S([B.first_name,B.last_name]," "),pe=S([B.street,B.house_number]," "),me=S([B.postal_code,B.city]," "),K=S([j.street,j.house_number]," "),te=S([j.zip,j.city]," ");let ne,ae;if(pe&&me)ne=[pe,me],ae="tenant";else if(K||te)ne=[K,te].filter(Boolean),ae="property",w.push("Für den Mieter ist keine eigene Anschrift hinterlegt – im Schreiben wurde die Objektadresse verwendet. Bei ausgezogenen Mietern bitte die aktuelle Anschrift im Mieterstamm ergänzen.");else throw new Error("Keine Empfängeranschrift vorhanden: Bitte die Anschrift des Mieters im Mieterstamm hinterlegen.");A||w.push("Für den Mieter ist kein Name hinterlegt.");let u="payment_reminder";if(c==="Mahnung")u="dunning_1";else if(c==="Abmahnung")u="dunning_2";else if(c==="Letzte Zahlungsaufforderung"||c==="dunning_final")u="dunning_final";else if(c!=="Zahlungserinnerung"){const t=c.toLowerCase();t.includes("erinnerung")?u="payment_reminder":t.includes("abmahnung")?u="dunning_2":t.includes("letzte")?u="dunning_final":u="dunning_1"}let T=Ne[u];try{let t=N.from("document_templates").select("*").eq("type",u);$?t=t.eq("portfolio_id",$):t=t.eq("user_id",e.user_id).is("portfolio_id",null);const{data:d,error:z}=await t.maybeSingle();if(!z&&d)T=d;else if($){const{data:M}=await N.from("document_templates").select("*").eq("user_id",e.user_id).eq("type",u).is("portfolio_id",null).maybeSingle();M&&(T=M)}}catch(t){console.error("Error fetching template for dunning PDF:",t)}const D=new Date,ce=ee(D),O=D.toLocaleDateString("de-DE"),ue=ge(D,E),ie=ee(ue);let k=n||null;const{data:he,error:re}=await N.from("claim_totals_view").select("*").eq("claim_id",e.id).maybeSingle();if(!re&&he?k=he:re&&console.warn("claim_totals_view nicht ladbar, verwende geladene Summen:",re),!k)throw new Error("Die Forderungssummen konnten nicht geladen werden. Bitte laden Sie die Seite neu.");const be=I(e.interest_rate??0),W=h(k.current_principal_open),fe=h(k.total_fees_open),q=h(k.total_interest_open),Te=h(k.total_due),de=h(k.accumulated_unpaid_interest),ve=h(k.live_interest_since_start),Oe=h(k.interest_paid),x=e.interest_start_date||null,ye=x?Math.max(0,Ee(x,D)):0;let L=V,Y=!1,se=1,g={current_principal_open:W,total_interest_open:q,total_fees_open:fe,total_due:Te};if(l){const t=V.find(le=>le.claim_item_id===l);if(!t)throw new Error("Die gewählte Forderungsposition wurde nicht gefunden. Bitte die Seite neu laden.");L=[t],Y=!0;const d=h(t.open_amount);se=W>0?Math.min(1,d/W):0;const z=h(q*se),M=h(Math.min(I(t.claim_items?.fee_amount),fe));g={current_principal_open:d,total_interest_open:z,total_fees_open:M,total_due:h(d+z+M)}}if(g.total_due<=0)throw new Error("Für diese Auswahl ist kein Betrag offen – es wird kein Mahnschreiben erzeugt.");const _e=L.filter(t=>I(t.open_amount)>0).map(t=>t.claim_items?.due_date||t.claim_items?.period_month).filter(Boolean).map(t=>H(t)).filter(Boolean).sort((t,d)=>t-d),Le=_e.length>0?st(_e[0],D):ye;let y=null;(f?.iban||"").trim()?y={name:f.bank_name,iban:f.iban,bic:f.bic,holder:(f.company_name||"").trim()||U}:(m?.iban||"").trim()&&(y={name:m.bank_name,iban:m.iban,bic:m.bic,holder:(m.bank_account_holder||"").trim()||U});const Pe=`Mahnung-${String(e.id).substring(0,8).toUpperCase()}`,Re=y?`Inhaber: ${y.holder}, ${y.name?"Bank: "+y.name+", ":""}IBAN: ${y.iban}${y.bic?", BIC: "+y.bic:""}, Verwendungszweck: ${Pe}`:"das Ihnen bekannte Bankkonto";y||w.push("Es ist keine Bankverbindung (IBAN) im Portfolio oder Profil hinterlegt – im Schreiben steht „das Ihnen bekannte Bankkonto“.");const Ze=e.leases?.start_date?X(e.leases.start_date):"Mietbeginn",Ce=`
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10pt;">
        <thead>
            <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                <th style="padding: 6px; text-align: left;">Forderungsposition</th>
                <th style="padding: 6px; text-align: right; width: 30%;">Betrag</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">${Y?p(L[0].claim_items?.description||L[0].claim_items?.item_type||"Hauptforderung"):"Offene Hauptforderungen (Miete/Nebenkosten etc.)"}</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${s(g.current_principal_open)}</td>
            </tr>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Verzugszinsen bis einschließlich ${O}</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${s(g.total_interest_open)}</td>
            </tr>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Mahnkosten / Auslagen</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${s(g.total_fees_open)}</td>
            </tr>
            <tr style="border-top: 2px solid #000; border-bottom: 2px double #000; background-color: #f8fafc;">
                <td style="padding: 8px; font-weight: bold; font-size: 11pt;">Gesamtforderung zum ${O}:</td>
                <td style="padding: 8px; text-align: right; font-weight: bold; font-size: 11pt; color: #dc2626;">${s(g.total_due)}</td>
            </tr>
        </tbody>
    </table>`,we=be.toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:4}),F=[];de!==0&&F.push([x?`Bis zum Zinsstichtag ${X(x)} bereits berechnete Verzugszinsen`:"Bereits berechnete Verzugszinsen","",x?`bis ${X(x)}`:"","",s(de)]),x&&F.push([`Laufende Zinsen auf die offene Hauptforderung (${we} % p.a.)`,s(W),`${X(x)} – ${O}`,String(ye),s(ve)]);const ke=h(de+ve-q);Oe>0&&ke>.004&&F.push(["Abzüglich bereits gezahlter Zinsen","","","",s(-ke)]),F.length===0&&F.push(["Keine Verzugszinsen berechnet","","","",s(0)]);const xe=[`
                <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;">
                    <td colspan="4" style="padding: 6px;">Summe offener Verzugszinsen${Y?" der gesamten Forderung":""}:</td>
                    <td style="padding: 6px; text-align: right;">${s(q)}</td>
                </tr>`];if(Y){const t=(se*100).toLocaleString("de-DE",{maximumFractionDigits:1});xe.push(`
                <tr style="font-weight: bold;">
                    <td colspan="4" style="padding: 6px;">Davon auf diese Position entfallend (anteilig nach offener Hauptforderung, ${t} %):</td>
                    <td style="padding: 6px; text-align: right;">${s(g.total_interest_open)}</td>
                </tr>`)}const Ie=`
    <div>
        <h3 style="font-size: 11pt; font-weight: bold; margin-top: 10px; margin-bottom: 8px; border-bottom: 1px solid #000; padding-bottom: 2px;">Anlage 1: Forderungsaufstellung</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 20px;">
            <thead>
                <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                    <th style="padding: 5px; text-align: left;">Position</th>
                    <th style="padding: 5px; text-align: right; width: 22%;">Forderungsbetrag</th>
                    <th style="padding: 5px; text-align: right; width: 22%;">Zahlung / Anrechnung</th>
                    <th style="padding: 5px; text-align: right; width: 22%; font-weight: bold;">Offener Betrag</th>
                </tr>
            </thead>
            <tbody>
                ${L.map(t=>`
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px; text-align: left;">${p(t.claim_items?.description||t.claim_items?.item_type||"Forderung")}</td>
                        <td style="padding: 5px; text-align: right;">${s(t.original_amount)}</td>
                        <td style="padding: 5px; text-align: right;">${s(t.paid_principal)}</td>
                        <td style="padding: 5px; text-align: right; font-weight: bold;">${s(t.open_amount)}</td>
                    </tr>
                `).join("")}
                <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;">
                    <td style="padding: 6px;">Summe offener Hauptforderungen:</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 6px; text-align: right;">${s(g.current_principal_open)}</td>
                </tr>
                <tr>
                    <td style="padding: 5px;">Mahnkosten / Auslagen (offen)</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 5px; text-align: right;">${s(g.total_fees_open)}</td>
                </tr>
                <tr>
                    <td style="padding: 5px;">Verzugszinsen (offen, siehe Anlage 2)</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 5px; text-align: right;">${s(g.total_interest_open)}</td>
                </tr>
                <tr style="border-top: 1px solid #000; font-weight: bold;">
                    <td style="padding: 6px;">Gesamtforderung zum ${O}:</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 6px; text-align: right;">${s(g.total_due)}</td>
                </tr>
            </tbody>
        </table>

        <h3 style="font-size: 11pt; font-weight: bold; margin-top: 15px; margin-bottom: 4px; border-bottom: 1px solid #000; padding-bottom: 2px;">Anlage 2: Zinsberechnung</h3>
        <p style="font-size: 8.5pt; color: #475569; margin-bottom: 8px;">
            Nach § 288 Abs. 1 BGB können Verzugszinsen in Höhe von fünf Prozentpunkten über dem jeweiligen Basiszinssatz verlangt werden.
            Der Berechnung liegt ein Zinssatz von ${we} % p.a. zugrunde. Zinstage werden ab dem Tag nach dem Zinsstichtag gezählt.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 20px;">
            <thead>
                <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                    <th style="padding: 5px; text-align: left;">Position</th>
                    <th style="padding: 5px; text-align: right; width: 20%;">Verzinslicher Betrag</th>
                    <th style="padding: 5px; text-align: left; width: 25%;">Zeitraum</th>
                    <th style="padding: 5px; text-align: right; width: 12%;">Tage</th>
                    <th style="padding: 5px; text-align: right; width: 18%; font-weight: bold;">Zinsen</th>
                </tr>
            </thead>
            <tbody>
                ${F.map(t=>`
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px; text-align: left;">${t[0]}</td>
                        <td style="padding: 5px; text-align: right;">${t[1]}</td>
                        <td style="padding: 5px; text-align: left;">${t[2]}</td>
                        <td style="padding: 5px; text-align: right;">${t[3]}</td>
                        <td style="padding: 5px; text-align: right; font-weight: bold;">${t[4]}</td>
                    </tr>
                `).join("")}
                ${xe.join("")}
            </tbody>
        </table>

        <h3 style="font-size: 11pt; font-weight: bold; margin-top: 15px; margin-bottom: 8px; border-bottom: 1px solid #000; padding-bottom: 2px;">Anlage 3: Ablauf bei Mietrückstand und mögliche Folgekosten</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 8pt; margin-bottom: 10px;">
            <thead>
                <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                    <th style="padding: 5px; text-align: left; width: 25%;">Schritt</th>
                    <th style="padding: 5px; text-align: left;">Erläuterung</th>
                    <th style="padding: 5px; text-align: left; width: 30%;">Mögliche Folgekosten</th>
                </tr>
            </thead>
            <tbody>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">1. Mietzahlung fällig</td>
                    <td style="padding: 4px;">Die Miete ist bis spätestens zum dritten Werktag des Monats zu zahlen.</td>
                    <td style="padding: 4px;">Keine Zusatzkosten bei fristgerechter Zahlung</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">2. Rückstand festgestellt</td>
                    <td style="padding: 4px;">Offene Miete wird ermittelt und tagesgenaue Verzugszinsen laufen an.</td>
                    <td style="padding: 4px;">Verzugszinsen nach § 288 BGB</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">3. Mahnung / Abmahnung</td>
                    <td style="padding: 4px;">Zahlungsfrist wird gesetzt. Die Forderung wird schriftlich beziffert.</td>
                    <td style="padding: 4px;">Auslagen für Porto/Druck</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">4. Keine fristgerechte Zahlung</td>
                    <td style="padding: 4px;">Weitere Beitreibung kann eingeleitet werden: Anwalt, Mahnbescheid oder Klage.</td>
                    <td style="padding: 4px;">Rechtsverfolgungs- und Gerichtskosten möglich</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">5. Kündigungsprüfung</td>
                    <td style="padding: 4px;">Bei erheblichem Mietrückstand kann eine fristlose, hilfsweise ordentliche Kündigung geprüft werden.</td>
                    <td style="padding: 4px;">Weitere Kostenrisiken für den Mieter</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">6. Gerichtliche Durchsetzung</td>
                    <td style="padding: 4px;">Bei weiterem Ausbleiben kann die Forderung tituliert und vollstreckt werden; bei Kündigung ggf. Räumungsklage.</td>
                    <td style="padding: 4px;">Gerichts-, Anwalts- und Vollstreckungskosten möglich</td>
                </tr>
            </tbody>
        </table>
        <div style="font-size: 8.5pt; font-weight: bold; color: #1e293b; margin-top: 8px; line-height: 1.4;">
            Wichtig: Durch vollständige und fristgerechte Zahlung können weitere Kosten und rechtliche Schritte vermieden werden.
            Die tatsächlichen Kosten hängen vom weiteren Verlauf und den gesetzlichen Gebühren ab.
        </div>
    </div>`;let ze="";if(b&&b.token&&b.pin){const t=gt(b.token);try{ze=`
            <div style="margin-top: 15px; margin-bottom: 15px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 12px; text-align: center; font-size: 9.5pt; page-break-inside: avoid;">
                <div style="margin-bottom: 6px;">
                    <img src="${await et.toDataURL(t,{margin:1,width:120})}" style="width: 80px; height: 80px; display: inline-block;" alt="QR Code" />
                </div>
                <div style="font-weight: bold; color: #1e293b; margin-bottom: 4px; font-size: 10pt;">Online Forderungsportal</div>
                <div style="color: #475569; line-height: 1.4; max-width: 480px; margin: 0 auto 6px; font-size: 8.5pt;">
                    Sie können die aktuelle Forderung auch online einsehen und eine Ratenzahlung anfragen. Scannen Sie hierzu den QR-Code und geben Sie den unten genannten Zugangscode ein.
                </div>
                <div style="font-weight: bold; color: #1e293b; font-size: 10pt;">
                    Zugangscode (PIN): <span style="background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${p(b.pin)}</span>
                </div>
            </div>`}catch(d){console.error("Failed to generate QR code for HTML print",d),w.push("Der QR-Code für das Forderungsportal konnte nicht erzeugt werden.")}}const He=A?`Sehr geehrte/r ${A}`:"Sehr geehrte Damen und Herren",Ge={mieter_name:p(A),mieter_anrede:p(He),mieter_adresse:ne.map(p).join("<br>"),objekt_name:p(K||"Immobilie"),einheit_name:p(e.leases?.units?.unit_name||"Einheit"),objekt_adresse:p(S([K,te],", ")),offener_betrag:s(g.total_due),zahlungsfrist_datum:ue.toLocaleDateString("de-DE"),verzugstage:String(Le),mahnstufe:p(c),zinsbetrag:s(g.total_interest_open),nutzungszeitraum:p(Ze),vermieter_name:p(U),vermieter_kontakt:$e.split(`
`).map(p).join("<br>"),vermieter_bankverbindung:p(Re),rechnungsdatum:O,forderungs_tabelle:Ce+ze,forderungs_detail_tabelle:Ie},Ue=(t,d)=>{if(!t)return"";let z=t;for(const[M,le]of Object.entries(d)){const Xe=new RegExp(`(<span[^>]*data-id="${M}"[^>]*>.*?</span>|\\{${M}\\})`,"g");z=z.replace(Xe,()=>le)}return z},Ke=T?.content_html||Ne[u].content_html,We=bt(Ke).replace(/Sehr geehrte(?:\/r|\(r\))?(?:\s|&nbsp;)*(?=<span[^>]*data-id="mieter_anrede")/gi,"").replace(/Sehr geehrte(?:\/r|\(r\))?(?:\s|&nbsp;)*(?=\{mieter_anrede\})/gi,""),qe=Ue(We,Ge),Ye=`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${p(c)} - ${p(A)}</title>
    <style>
        ${tt()}
        @page { size: A4; margin: 0; }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; background: #fff; font-family: 'Open Sans', Arial, sans-serif; font-size: 11pt; color: #000; }
        .letter-page {
            width: 210mm;
            height: 297mm;
            padding: 20mm 20mm 35mm 25mm;
            margin: 0 auto;
            background: #ffffff;
            color: #000000;
            box-sizing: border-box;
            position: relative;
            display: flex;
            flex-direction: column;
            text-align: left;
            page-break-after: always;
            page-break-inside: avoid;
        }
        .letter-page > p {
            min-height: 1.2em;
            margin: 0;
        }
        .letter-sender {
            font-size: 8pt;
            color: #555555;
            border-bottom: 1px solid #cccccc;
            padding-bottom: 2mm;
            margin-bottom: 5mm;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .letter-header-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 10mm;
        }
        .letter-recipient {
            width: 85mm;
            font-size: 10pt;
            line-height: 1.4;
            color: #111111;
            text-align: left;
        }
        .letter-date {
            font-size: 10pt;
            color: #333333;
            text-align: right;
        }
        .letter-subject {
            font-size: 13pt;
            font-weight: bold;
            margin-bottom: 4mm;
            color: #000000;
            text-align: left;
        }
        .letter-object {
            font-size: 10pt;
            color: #444444;
            margin-bottom: 8mm;
            padding-bottom: 2mm;
            border-bottom: 1px dotted #e2e8f0;
            text-align: left;
        }
        .letter-body {
            flex-grow: 1;
            flex-shrink: 1;
            min-height: 0;
            overflow: hidden;
            font-size: 11pt;
            line-height: 1.6;
            text-align: left;
        }
        .letter-body p {
            margin-bottom: 1em !important;
        }
        .letter-footer {
            position: absolute !important;
            bottom: 10mm !important;
            left: 25mm !important;
            right: 20mm !important;
            height: 18mm !important;
            margin-top: 0 !important;
            display: flex !important;
            justify-content: space-between !important;
            border-top: 1px solid #dddddd !important;
            padding-top: 3mm !important;
            font-size: 8pt !important;
            color: #666666 !important;
            line-height: 1.4 !important;
            text-align: left !important;
            box-sizing: border-box !important;
            background-color: #ffffff !important;
        }
        .footer-col {
            width: 30%;
        }
        @media print {
            body {
                margin: 0;
                padding: 0;
                background: #fff;
            }
            .letter-page {
                margin: 0 !important;
                border: none !important;
                box-shadow: none !important;
                page-break-after: always !important;
                page-break-inside: avoid !important;
                width: 210mm !important;
                height: 297mm !important;
            }
        }
    </style></head><body style="background:#fff">
    ${qe}
    </body></html>`,Qe=(A||"Mieter").replace(/[^a-z0-9]/gi,"_").replace(/_+/g,"_"),Q=`${c.replace(/[^a-z0-9äöüß]/gi,"_").replace(/_+/g,"_")}_Zahlungsverzug_${Qe}_${ce}.pdf`,v=document.createElement("iframe");v.setAttribute("aria-hidden","true"),v.tabIndex=-1,v.style.position="absolute",v.style.left="-9999px",v.style.width="210mm",v.style.height="297mm";let P;try{document.body.appendChild(v);const t=v.contentDocument;t.open(),t.write(Ye),t.close();const d=await vt();try{document.fonts&&document.fonts.ready&&await Promise.race([document.fonts.ready,Fe(3e3)])}catch{}await Fe(600),P=await d().set({margin:10,filename:Q,image:{type:"jpeg",quality:.98},html2canvas:{scale:2,useCORS:!0},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(t.body).output("arraybuffer")}finally{v.parentNode&&v.parentNode.removeChild(v)}if(!P||!P.byteLength)throw new Error("Das PDF konnte nicht erzeugt werden.");let Me=null;try{const t=await crypto.subtle.digest("SHA-256",P);Me=Array.from(new Uint8Array(t)).map(d=>d.toString(16).padStart(2,"0")).join("")}catch(t){console.warn("SHA-256 nicht berechenbar:",t)}const Se={document_type:c,document_date:ce,snapshot_date:D.toISOString(),amount_source:"claim_totals_view",principal_snapshot:g.current_principal_open,fees_snapshot:g.total_fees_open,interest_snapshot:g.total_interest_open,total_snapshot:g.total_due,total_due_at_generation:g.total_due,interest_rate:be,deadline:ie,deadline_date:ie,deadline_days:E,document_file_name:Q,document_stored:!1,document_sha256:Me,template_type:u,template_id:T?.id||null,template_updated_at:T?.updated_at||null,recipient_address_source:ae,target_item_id:l||null},{error:R}=await N.from("claim_events").insert([{user_id:e.user_id,claim_id:e.id,event_type:"dunning_sent",description:`${c} erstellt`,event_metadata:Se}]);R&&console.error("Error saving claim_event:",R);const Je=new Blob([P],{type:"application/pdf"}),J=URL.createObjectURL(Je);let Z=!1,Be=!1;const oe=_?.targetWindow;if(oe&&!oe.closed)try{oe.location.href=J,Z=!0}catch(t){console.warn("Vorab geöffnetes Fenster nicht nutzbar:",t)}if(Z||(Z=!!window.open(J,"_blank")),!Z){const t=document.createElement("a");t.href=J,t.download=Q,t.rel="noopener",document.body.appendChild(t),t.click(),t.remove(),Be=!0}return setTimeout(()=>URL.revokeObjectURL(J),300*1e3),{fileName:Q,eventMetadata:Se,deadlineDate:ie,warnings:w,historySaved:!R,historyError:R?mt(R):null,opened:Z,downloaded:Be}};export{ee as a,gt as b,yt as c,Ee as d,Bt as e,at as f,st as g,St as h,Mt as i,I as n,H as p,h as r,dt as s,mt as t};
