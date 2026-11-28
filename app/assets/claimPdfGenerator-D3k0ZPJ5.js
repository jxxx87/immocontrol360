import{s as z}from"./index-fJX686dm.js";import{Q as tt}from"./browser-C0iTNLej.js";import{o as nt}from"./fontFaces-DyasV2Ow.js";import{l as rt}from"./htmlToPdf-B7gBvvYV.js";import{D as Ae,f as it}from"./defaultTemplates-CB0Jqh6V.js";import{s as ot,L as at}from"./letterDocumentCss-Crp3aGAL.js";import{A as st}from"./utilitySettlement-CmUVXNY3.js";const dt={},Te=e=>String(e).padStart(2,"0"),T=e=>{const n=typeof e=="number"?e:parseFloat(e);return Number.isFinite(n)?n:0},u=e=>Math.round((T(e)+Number.EPSILON)*100)/100,te=(e=new Date)=>`${e.getFullYear()}-${Te(e.getMonth()+1)}-${Te(e.getDate())}`,V=e=>{if(!e)return null;if(e instanceof Date)return isNaN(e.getTime())?null:new Date(e.getFullYear(),e.getMonth(),e.getDate());const n=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(e).trim());if(n){const o=new Date(Number(n[1]),Number(n[2])-1,Number(n[3]));return isNaN(o.getTime())?null:o}const r=new Date(e);return isNaN(r.getTime())?null:new Date(r.getFullYear(),r.getMonth(),r.getDate())},me=(e,n)=>{const r=new Date(e.getFullYear(),e.getMonth(),e.getDate());return r.setDate(r.getDate()+n),r},Ct=(e,n)=>{const r=new Date(e.getFullYear(),e.getMonth()+n,1),o=new Date(r.getFullYear(),r.getMonth()+1,0).getDate();return r.setDate(Math.min(e.getDate(),o)),r},Ce=(e,n)=>{const r=V(e),o=V(n);if(!r||!o)return 0;const s=Date.UTC(r.getFullYear(),r.getMonth(),r.getDate()),c=Date.UTC(o.getFullYear(),o.getMonth(),o.getDate());return Math.round((c-s)/864e5)},lt=e=>{const n=V(e);return n?n.toLocaleDateString("de-DE"):""},Ne=e=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(T(e)),ct=e=>{const n=e%19,r=Math.floor(e/100),o=e%100,s=Math.floor(r/4),c=r%4,g=Math.floor((r+8)/25),D=Math.floor((r-g+1)/3),$=(19*n+r-s-D+15)%30,F=Math.floor(o/4),f=o%4,y=(32+2*c+2*F-$-f)%7,B=Math.floor((n+11*$+22*y)/451),m=Math.floor(($+y-7*B+114)/31),q=($+y-7*B+114)%31+1;return new Date(e,m-1,q)},pt=e=>{const n=e.getFullYear(),r=te(e),o=ct(n),s=[`${n}-01-01`,`${n}-05-01`,`${n}-10-03`,`${n}-12-25`,`${n}-12-26`],c=[-2,1,39,50].map(g=>te(me(o,g)));return s.includes(r)||c.includes(r)},gt=e=>{let n=V(e);if(!n)return null;let r=0;for(;(n.getDay()===0||n.getDay()===6||pt(n))&&r<10;)n=me(n,1),r++;return n},mt=(e,n=new Date)=>{const r=gt(e);return r?Math.max(0,Ce(r,n)):0},ut="https://app.immocontrol360.de",ft=()=>{const e=dt?.VITE_PUBLIC_APP_URL;return e&&/^https?:\/\//i.test(e)?e.replace(/\/+$/,""):typeof window<"u"&&!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform())||typeof window>"u"?ut:window.location.origin},ht=e=>`${ft()}/forderung/portal/${encodeURIComponent(e||"")}`,Fe="claim-documents",bt=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,_t=(e,n="Die Aktion konnte nicht ausgeführt werden.")=>{const r=String(e?.message||e?.details||(typeof e=="string"?e:"")||"").trim();if(!r)return n;if(/gehört Owner|RLS verhindert/i.test(r))return"Forderungen können derzeit nur vom Eigentümer des Mietvertrags angelegt werden.";if(/invalid input syntax for type (numeric|integer|date)/i.test(r))return"Ein eingegebener Betrag oder ein Datum ist ungültig. Bitte prüfen Sie die Eingaben.";if(/row-level security|permission denied|violates row-level/i.test(r))return"Sie haben keine Berechtigung für diese Aktion.";if(/failed to fetch|network request failed|networkerror/i.test(r))return"Verbindungsfehler. Bitte prüfen Sie Ihre Internetverbindung.";let o=r.replace(/(\d+(?:\.\d+)?)\.2f/g,(s,c)=>Ne(Number(c)));return o=o.replace(bt,"…"),o},l=e=>String(e??"").replace(/[&<>"']/g,n=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n]),yt=new Set(["SCRIPT","IFRAME","FRAME","FRAMESET","OBJECT","EMBED","APPLET","LINK","META","BASE","FORM","INPUT","BUTTON","TEXTAREA","SELECT","OPTION","NOSCRIPT","TEMPLATE","SVG","MATH"]),wt=new Set(["href","src","xlink:href","action","formaction","background","poster","srcset","data","lowsrc","dynsrc","ping","cite","longdesc"]),xt=(e,n)=>{const r=String(e||"").replace(/[\u0000- ]+/g,"").toLowerCase();return r.startsWith("javascript:")||r.startsWith("vbscript:")?!1:r.startsWith("data:")?n==="src"&&r.startsWith("data:image/")&&!r.startsWith("data:image/svg"):!0},Dt=e=>{if(!e)return"";if(typeof DOMParser>"u")return String(e).replace(/<script[\s\S]*?<\/script>/gi,"");const n=new DOMParser().parseFromString(`<!DOCTYPE html><html><head></head><body>${e}</body></html>`,"text/html"),r=o=>{Array.from(o.childNodes).forEach(s=>{if(s.nodeType===8){s.remove();return}if(s.nodeType===1){if(yt.has(String(s.tagName).toUpperCase())){s.remove();return}Array.from(s.attributes).forEach(c=>{const g=c.name.toLowerCase();(g.startsWith("on")||g==="srcdoc"||g==="formaction"||wt.has(g)&&!xt(c.value,g)||g==="style"&&/expression\s*\(|javascript:|behavior\s*:/i.test(c.value))&&s.removeAttribute(c.name)}),r(s)}})};return r(n.body),n.body.innerHTML},Be=e=>new Promise(n=>setTimeout(n,e)),kt=`
.ic-claim-doc { width: 210mm; background: #ffffff; color: #000000; text-align: left; }
${ot(at,".ic-claim-doc")}
.ic-claim-doc .letter-page { height: 296mm !important; min-height: 296mm !important; max-height: 296mm !important; padding-bottom: 34mm !important; margin: 0 !important; box-shadow: none !important; border-radius: 0 !important; page-break-inside: avoid; break-inside: avoid; }
.ic-claim-doc .letter-page ~ .letter-page { page-break-before: always; break-before: page; }
.ic-claim-doc > p:empty { display: none; }
.ic-claim-doc table { background: transparent !important; box-shadow: none !important; border-radius: 0 !important; overflow: visible !important; border: none; }
.ic-claim-doc th, .ic-claim-doc td { color: #000000; background-color: transparent; font-size: inherit; }
`,a=Ne,ee=lt,Nt=e=>e==="Zahlungserinnerung"?1:e==="Abmahnung"||e==="Mahnung"?2:e==="Letzte Zahlungsaufforderung"||e==="dunning_final"?3:0,vt=e=>{const n=Number(e);return e===""||e===null||e===void 0||!Number.isInteger(n)||n<1||n>365?null:n},E=(e,n)=>e.map(r=>(r||"").trim()).filter(Boolean).join(n),Pt=async(e,n,r,o,s,c,g,D,$={})=>{if(!e?.id)throw new Error("Die Forderung ist nicht geladen.");const F=vt(s);if(F===null)throw new Error("Bitte eine gültige Zahlungsfrist angeben (ganze Zahl von 1 bis 365 Tagen).");const f=String(o||"Zahlungserinnerung"),y=[],B=Array.isArray(r)?r:[],{data:m,error:q}=await z.from("profiles").select("first_name, last_name, company, email, phone, bank_name, iban, bic, bank_account_holder").eq("id",e.user_id).maybeSingle();q&&console.warn("Absenderprofil nicht lesbar:",q);const C=e.leases?.units?.properties||{},N=C.portfolio_id;let b=null;if(N){const{data:t,error:i}=await z.from("portfolios").select("company_name, email, phone, bank_name, iban, bic").eq("id",N).maybeSingle();i&&console.warn("Portfolio-Daten nicht lesbar:",i),b=t||null}const Pe=E([m?.first_name,m?.last_name]," "),K=(m?.company||"").trim()||Pe||(b?.company_name||"").trim();if(!K)throw new Error("Absenderangaben fehlen: Bitte hinterlegen Sie Name bzw. Firma im Profil des Eigentümers oder den Firmennamen im Portfolio, bevor ein Mahnschreiben erzeugt wird.");const Le=E([b?.email||m?.email?`E-Mail: ${b?.email||m?.email}`:"",b?.phone||m?.phone?`Tel.: ${b?.phone||m?.phone}`:""],`
`),v=e.tenants||{},P=E([v.first_name,v.last_name]," "),ue=E([v.street,v.house_number]," "),fe=E([v.postal_code,v.city]," "),G=E([C.street,C.house_number]," "),ne=E([C.zip,C.city]," ");let re,ie;if(ue&&fe)re=[ue,fe],ie="tenant";else if(G||ne)re=[G,ne].filter(Boolean),ie="property",y.push("Für den Mieter ist keine eigene Anschrift hinterlegt – im Schreiben wurde die Objektadresse verwendet. Bei ausgezogenen Mietern bitte die aktuelle Anschrift im Mieterstamm ergänzen.");else throw new Error("Keine Empfängeranschrift vorhanden: Bitte die Anschrift des Mieters im Mieterstamm hinterlegen.");P||y.push("Für den Mieter ist kein Name hinterlegt.");let oe=v.salutation;if(oe===void 0&&e.tenant_id){const{data:t,error:i}=await z.from("tenants").select("salutation").eq("id",e.tenant_id).maybeSingle();i&&console.warn("Anrede des Mieters nicht lesbar – neutrale Briefanrede:",i),oe=t?.salutation??null}let h="payment_reminder";if(f==="Mahnung")h="dunning_1";else if(f==="Abmahnung")h="dunning_2";else if(f==="Letzte Zahlungsaufforderung"||f==="dunning_final")h="dunning_final";else if(f!=="Zahlungserinnerung"){const t=f.toLowerCase();t.includes("erinnerung")?h="payment_reminder":t.includes("abmahnung")?h="dunning_2":t.includes("letzte")?h="dunning_final":h="dunning_1"}let L=Ae[h];try{let t=z.from("document_templates").select("*").eq("type",h);N?t=t.eq("portfolio_id",N):t=t.eq("user_id",e.user_id).is("portfolio_id",null);const{data:i,error:p}=await t.maybeSingle();if(!p&&i)L=i;else if(N){const{data:x}=await z.from("document_templates").select("*").eq("user_id",e.user_id).eq("type",h).is("portfolio_id",null).maybeSingle();x&&(L=x)}}catch(t){console.error("Error fetching template for dunning PDF:",t)}const M=new Date,ae=te(M),R=M.toLocaleDateString("de-DE"),he=me(M,F),se=te(he);let k=n||null;const{data:be,error:de}=await z.from("claim_totals_view").select("*").eq("claim_id",e.id).maybeSingle();if(!de&&be?k=be:de&&console.warn("claim_totals_view nicht ladbar, verwende geladene Summen:",de),!k)throw new Error("Die Forderungssummen konnten nicht geladen werden. Bitte laden Sie die Seite neu.");const _e=T(e.interest_rate??0),W=u(k.current_principal_open),ye=u(k.total_fees_open),Y=u(k.total_interest_open),Re=u(k.total_due),le=u(k.accumulated_unpaid_interest),we=u(k.live_interest_since_start),Ie=u(k.interest_paid),S=e.interest_start_date||null,xe=S?Math.max(0,Ce(S,M)):0;let I=B,Q=!1,ce=1,d={current_principal_open:W,total_interest_open:Y,total_fees_open:ye,total_due:Re};if(g){const t=B.find(ge=>ge.claim_item_id===g);if(!t)throw new Error("Die gewählte Forderungsposition wurde nicht gefunden. Bitte die Seite neu laden.");I=[t],Q=!0;const i=u(t.open_amount);ce=W>0?Math.min(1,i/W):0;const p=u(Y*ce),x=u(Math.min(T(t.claim_items?.fee_amount),ye));d={current_principal_open:i,total_interest_open:p,total_fees_open:x,total_due:u(i+p+x)}}if(d.total_due<=0)throw new Error("Für diese Auswahl ist kein Betrag offen – es wird kein Mahnschreiben erzeugt.");const De=I.filter(t=>T(t.open_amount)>0).map(t=>t.claim_items?.due_date||t.claim_items?.period_month).filter(Boolean).map(t=>V(t)).filter(Boolean).sort((t,i)=>t-i),Oe=De.length>0?mt(De[0],M):xe;let w=null;(b?.iban||"").trim()?w={name:b.bank_name,iban:b.iban,bic:b.bic,holder:(b.company_name||"").trim()||K}:(m?.iban||"").trim()&&(w={name:m.bank_name,iban:m.iban,bic:m.bic,holder:(m.bank_account_holder||"").trim()||K});const Ue=`Mahnung-${String(e.id).substring(0,8).toUpperCase()}`,Ze=w?`Inhaber: ${w.holder}, ${w.name?"Bank: "+w.name+", ":""}IBAN: ${w.iban}${w.bic?", BIC: "+w.bic:""}, Verwendungszweck: ${Ue}`:"das Ihnen bekannte Bankkonto";w||y.push("Es ist keine Bankverbindung (IBAN) im Portfolio oder Profil hinterlegt – im Schreiben steht „das Ihnen bekannte Bankkonto“.");const He=e.leases?.start_date?ee(e.leases.start_date):"Mietbeginn",je=`
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10pt;">
        <thead>
            <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                <th style="padding: 6px; text-align: left;">Forderungsposition</th>
                <th style="padding: 6px; text-align: right; width: 30%;">Betrag</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">${Q?l(I[0].claim_items?.description||I[0].claim_items?.item_type||"Hauptforderung"):"Offene Hauptforderungen (Miete/Nebenkosten etc.)"}</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${a(d.current_principal_open)}</td>
            </tr>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Verzugszinsen bis einschließlich ${R}</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${a(d.total_interest_open)}</td>
            </tr>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Mahnkosten / Auslagen</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${a(d.total_fees_open)}</td>
            </tr>
            <tr style="border-top: 2px solid #000; border-bottom: 2px double #000; background-color: #f8fafc;">
                <td style="padding: 8px; font-weight: bold; font-size: 11pt;">Gesamtforderung zum ${R}:</td>
                <td style="padding: 8px; text-align: right; font-weight: bold; font-size: 11pt; color: #dc2626;">${a(d.total_due)}</td>
            </tr>
        </tbody>
    </table>`,ke=_e.toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:4}),A=[];le!==0&&A.push([S?`Bis zum Zinsstichtag ${ee(S)} bereits berechnete Verzugszinsen`:"Bereits berechnete Verzugszinsen","",S?`bis ${ee(S)}`:"","",a(le)]),S&&A.push([`Laufende Zinsen auf die offene Hauptforderung (${ke} % p.a.)`,a(W),`${ee(S)} – ${R}`,String(xe),a(we)]);const ve=u(le+we-Y);Ie>0&&ve>.004&&A.push(["Abzüglich bereits gezahlter Zinsen","","","",a(-ve)]),A.length===0&&A.push(["Keine Verzugszinsen berechnet","","","",a(0)]);const Se=[`
                <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;">
                    <td colspan="4" style="padding: 6px;">Summe offener Verzugszinsen${Q?" der gesamten Forderung":""}:</td>
                    <td style="padding: 6px; text-align: right;">${a(Y)}</td>
                </tr>`];if(Q){const t=(ce*100).toLocaleString("de-DE",{maximumFractionDigits:1});Se.push(`
                <tr style="font-weight: bold;">
                    <td colspan="4" style="padding: 6px;">Davon auf diese Position entfallend (anteilig nach offener Hauptforderung, ${t} %):</td>
                    <td style="padding: 6px; text-align: right;">${a(d.total_interest_open)}</td>
                </tr>`)}const Ve=`
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
                ${I.map(t=>{const i=u(t.waived_amount??t.waived_principal),p=u(T(t.paid_principal)-i);return`
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px; text-align: left;">${l(t.claim_items?.description||t.claim_items?.item_type||"Forderung")}</td>
                        <td style="padding: 5px; text-align: right;">${a(t.original_amount)}</td>
                        <td style="padding: 5px; text-align: right;">${a(p)}${i>0?`<div style="font-size: 8pt; color: #475569;">Erlass: ${a(i)}</div>`:""}</td>
                        <td style="padding: 5px; text-align: right; font-weight: bold;">${a(t.open_amount)}</td>
                    </tr>
                `}).join("")}
                <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;">
                    <td style="padding: 6px;">Summe offener Hauptforderungen:</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 6px; text-align: right;">${a(d.current_principal_open)}</td>
                </tr>
                <tr>
                    <td style="padding: 5px;">Mahnkosten / Auslagen (offen)</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 5px; text-align: right;">${a(d.total_fees_open)}</td>
                </tr>
                <tr>
                    <td style="padding: 5px;">Verzugszinsen (offen, siehe Anlage 2)</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 5px; text-align: right;">${a(d.total_interest_open)}</td>
                </tr>
                <tr style="border-top: 1px solid #000; font-weight: bold;">
                    <td style="padding: 6px;">Gesamtforderung zum ${R}:</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 6px; text-align: right;">${a(d.total_due)}</td>
                </tr>
            </tbody>
        </table>

        <h3 style="font-size: 11pt; font-weight: bold; margin-top: 15px; margin-bottom: 4px; border-bottom: 1px solid #000; padding-bottom: 2px;">Anlage 2: Zinsberechnung</h3>
        <p style="font-size: 8.5pt; color: #475569; margin-bottom: 8px;">
            Nach § 288 Abs. 1 BGB können Verzugszinsen in Höhe von fünf Prozentpunkten über dem jeweiligen Basiszinssatz verlangt werden.
            Der Berechnung liegt ein Zinssatz von ${ke} % p.a. zugrunde. Zinstage werden ab dem Tag nach dem Zinsstichtag gezählt.
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
                ${A.map(t=>`
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px; text-align: left;">${t[0]}</td>
                        <td style="padding: 5px; text-align: right;">${t[1]}</td>
                        <td style="padding: 5px; text-align: left;">${t[2]}</td>
                        <td style="padding: 5px; text-align: right;">${t[3]}</td>
                        <td style="padding: 5px; text-align: right; font-weight: bold;">${t[4]}</td>
                    </tr>
                `).join("")}
                ${Se.join("")}
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
    </div>`;let ze="";if(D&&D.token&&D.pin){const t=ht(D.token);try{ze=`
            <div style="margin-top: 15px; margin-bottom: 15px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 12px; text-align: center; font-size: 9.5pt; page-break-inside: avoid;">
                <div style="margin-bottom: 6px;">
                    <img src="${await tt.toDataURL(t,{margin:1,width:120})}" style="width: 80px; height: 80px; display: inline-block;" alt="QR Code" />
                </div>
                <div style="font-weight: bold; color: #1e293b; margin-bottom: 4px; font-size: 10pt;">Online Forderungsportal</div>
                <div style="color: #475569; line-height: 1.4; max-width: 480px; margin: 0 auto 6px; font-size: 8.5pt;">
                    Sie können die aktuelle Forderung auch online einsehen und eine Ratenzahlung anfragen. Scannen Sie hierzu den QR-Code und geben Sie den unten genannten Zugangscode ein.
                </div>
                <div style="font-weight: bold; color: #1e293b; font-size: 10pt;">
                    Zugangscode (PIN): <span style="background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${l(D.pin)}</span>
                </div>
            </div>`}catch(i){console.error("Failed to generate QR code for HTML print",i),y.push("Der QR-Code für das Forderungsportal konnte nicht erzeugt werden.")}}const qe=st({fullName:P,lastName:v.last_name,salutation:oe}),Ke={mieter_name:l(P),mieter_anrede:l(qe),mieter_adresse:re.map(l).join("<br>"),objekt_name:l(G||"Immobilie"),einheit_name:l(e.leases?.units?.unit_name||"Einheit"),objekt_adresse:l(E([G,ne],", ")),offener_betrag:a(d.total_due),zahlungsfrist_datum:he.toLocaleDateString("de-DE"),verzugstage:String(Oe),mahnstufe:l(f),zinsbetrag:a(d.total_interest_open),nutzungszeitraum:l(He),vermieter_name:l(K),vermieter_kontakt:Le.split(`
`).map(l).join("<br>"),vermieter_bankverbindung:l(Ze),rechnungsdatum:R,forderungs_tabelle:je+ze,forderungs_detail_tabelle:Ve},Ge=(t,i)=>{if(!t)return"";let p=t;for(const[x,ge]of Object.entries(i)){const et=new RegExp(`(<span[^>]*data-id="${x}"[^>]*>.*?</span>|\\{${x}\\})`,"g");p=p.replace(et,()=>ge)}return p},We=it(L?.content_html||Ae[h].content_html),Ye=Dt(We).replace(/Sehr geehrte(?:\/r|\(r\)|r)?(?:\s|&nbsp;)*(?=<span[^>]*data-id="mieter_anrede")/gi,"").replace(/Sehr geehrte(?:\/r|\(r\)|r)?(?:\s|&nbsp;)*(?=\{mieter_anrede\})/gi,""),Qe=Ge(Ye,Ke),Xe=`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${l(f)} - ${l(P)}</title>
    <style>${nt()} @page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; background: #ffffff; }</style>
    </head><body style="background:#fff"><div class="ic-claim-doc"><style>${kt}</style>${Qe}</div></body></html>`,Je=(P||"Mieter").replace(/[^a-z0-9äöüß]/gi,"_").replace(/_+/g,"_").replace(/^_|_$/g,"")||"Mieter",O=`${f.replace(/[^a-z0-9äöüß]/gi,"_").replace(/_+/g,"_")}_Zahlungsverzug_${Je}_${ae}.pdf`,_=document.createElement("iframe");_.setAttribute("aria-hidden","true"),_.tabIndex=-1,_.style.position="absolute",_.style.left="-9999px",_.style.width="210mm",_.style.height="297mm";let U;try{document.body.appendChild(_);const t=_.contentDocument;t.open(),t.write(Xe),t.close();const i=await rt();try{if(document.fonts&&document.fonts.ready){const p=typeof document.fonts.load=="function"?Promise.all(['400 11pt "Open Sans"','600 11pt "Open Sans"','700 11pt "Open Sans"'].map(x=>document.fonts.load(x))).then(()=>document.fonts.ready):document.fonts.ready;await Promise.race([p,Be(3e3)])}}catch{}await Be(600),U=await i().set({margin:0,filename:O,image:{type:"jpeg",quality:.98},html2canvas:{scale:2,useCORS:!0,backgroundColor:"#ffffff",scrollX:0,scrollY:0},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},pagebreak:{mode:["css"]}}).from(t.querySelector(".ic-claim-doc")||t.body).output("arraybuffer")}finally{_.parentNode&&_.parentNode.removeChild(_)}if(!U||!U.byteLength)throw new Error("Das PDF konnte nicht erzeugt werden.");let Ee=null;try{const t=await crypto.subtle.digest("SHA-256",U);Ee=Array.from(new Uint8Array(t)).map(i=>i.toString(16).padStart(2,"0")).join("")}catch(t){console.warn("SHA-256 nicht berechenbar:",t)}const $e=new Blob([U],{type:"application/pdf"});let X=null;try{const t=O.replace(/[^A-Za-z0-9._-]/g,"_"),i=`${e.id}/${ae}_${Date.now()}_${t}`,{error:p}=await z.storage.from(Fe).upload(i,$e,{contentType:"application/pdf",upsert:!1});if(p)throw p;X=i}catch(t){console.warn("PDF konnte nicht archiviert werden:",t),y.push("Das PDF konnte nicht in der App archiviert werden. Bitte legen Sie es selbst ab.")}const Z={document_type:f,document_date:ae,snapshot_date:M.toISOString(),amount_source:"claim_totals_view",principal_snapshot:d.current_principal_open,fees_snapshot:d.total_fees_open,interest_snapshot:d.total_interest_open,total_snapshot:d.total_due,total_due_at_generation:d.total_due,interest_rate:_e,deadline:se,deadline_date:se,deadline_days:F,document_file_name:O,document_stored:!!X,document_sha256:Ee,template_type:h,template_id:L?.id||null,template_updated_at:L?.updated_at||null,recipient_address_source:ie,target_item_id:g||null};X&&(Z.document_bucket=Fe,Z.document_storage_path=X),D?.token&&D?.pin&&(Z.portal_access_printed=!0);const{error:H}=await z.from("claim_events").insert([{user_id:e.user_id,claim_id:e.id,event_type:"dunning_sent",description:`${f} erstellt`,event_metadata:Z}]);H&&console.error("Error saving claim_event:",H);const J=URL.createObjectURL($e);let j=!1,Me=!1;const pe=$?.targetWindow;if(pe&&!pe.closed)try{pe.location.href=J,j=!0}catch(t){console.warn("Vorab geöffnetes Fenster nicht nutzbar:",t)}if(j||(j=!!window.open(J,"_blank")),!j){const t=document.createElement("a");t.href=J,t.download=O,t.rel="noopener",document.body.appendChild(t),t.click(),t.remove(),Me=!0}return setTimeout(()=>URL.revokeObjectURL(J),300*1e3),{fileName:O,eventMetadata:Z,deadlineDate:se,warnings:y,historySaved:!H,historyError:H?_t(H):null,opened:j,downloaded:Me}};export{Fe as C,te as a,ht as b,vt as c,Ce as d,Pt as e,lt as f,mt as g,Nt as h,Ct as i,T as n,V as p,u as r,gt as s,_t as t};
