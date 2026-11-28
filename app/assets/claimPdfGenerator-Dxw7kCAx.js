import{s as S}from"./index-D-mHswkF.js";import{Q as et}from"./browser-DTbHE4dP.js";import{o as tt}from"./fontFaces-DyasV2Ow.js";import{l as nt}from"./htmlToPdf-Uas9jH_t.js";import{D as Me,f as rt}from"./defaultTemplates-CB0Jqh6V.js";const it={},Ae=e=>String(e).padStart(2,"0"),F=e=>{const n=typeof e=="number"?e:parseFloat(e);return Number.isFinite(n)?n:0},m=e=>Math.round((F(e)+Number.EPSILON)*100)/100,te=(e=new Date)=>`${e.getFullYear()}-${Ae(e.getMonth()+1)}-${Ae(e.getDate())}`,V=e=>{if(!e)return null;if(e instanceof Date)return isNaN(e.getTime())?null:new Date(e.getFullYear(),e.getMonth(),e.getDate());const n=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(e).trim());if(n){const o=new Date(Number(n[1]),Number(n[2])-1,Number(n[3]));return isNaN(o.getTime())?null:o}const r=new Date(e);return isNaN(r.getTime())?null:new Date(r.getFullYear(),r.getMonth(),r.getDate())},ce=(e,n)=>{const r=new Date(e.getFullYear(),e.getMonth(),e.getDate());return r.setDate(r.getDate()+n),r},$t=(e,n)=>{const r=new Date(e.getFullYear(),e.getMonth()+n,1),o=new Date(r.getFullYear(),r.getMonth()+1,0).getDate();return r.setDate(Math.min(e.getDate(),o)),r},Be=(e,n)=>{const r=V(e),o=V(n);if(!r||!o)return 0;const s=Date.UTC(r.getFullYear(),r.getMonth(),r.getDate()),g=Date.UTC(o.getFullYear(),o.getMonth(),o.getDate());return Math.round((g-s)/864e5)},ot=e=>{const n=V(e);return n?n.toLocaleDateString("de-DE"):""},Ne=e=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(F(e)),at=e=>{const n=e%19,r=Math.floor(e/100),o=e%100,s=Math.floor(r/4),g=r%4,p=Math.floor((r+8)/25),w=Math.floor((r-p+1)/3),$=(19*n+r-s-w+15)%30,B=Math.floor(o/4),f=o%4,_=(32+2*g+2*B-$-f)%7,N=Math.floor((n+11*$+22*_)/451),c=Math.floor(($+_-7*N+114)/31),q=($+_-7*N+114)%31+1;return new Date(e,c-1,q)},st=e=>{const n=e.getFullYear(),r=te(e),o=at(n),s=[`${n}-01-01`,`${n}-05-01`,`${n}-10-03`,`${n}-12-25`,`${n}-12-26`],g=[-2,1,39,50].map(p=>te(ce(o,p)));return s.includes(r)||g.includes(r)},dt=e=>{let n=V(e);if(!n)return null;let r=0;for(;(n.getDay()===0||n.getDay()===6||st(n))&&r<10;)n=ce(n,1),r++;return n},lt=(e,n=new Date)=>{const r=dt(e);return r?Math.max(0,Be(r,n)):0},gt="https://app.immocontrol360.de",pt=()=>{const e=it?.VITE_PUBLIC_APP_URL;return e&&/^https?:\/\//i.test(e)?e.replace(/\/+$/,""):typeof window<"u"&&!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform())||typeof window>"u"?gt:window.location.origin},ct=e=>`${pt()}/forderung/portal/${encodeURIComponent(e||"")}`,Te="claim-documents",mt=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,ft=(e,n="Die Aktion konnte nicht ausgeführt werden.")=>{const r=String(e?.message||e?.details||(typeof e=="string"?e:"")||"").trim();if(!r)return n;if(/gehört Owner|RLS verhindert/i.test(r))return"Forderungen können derzeit nur vom Eigentümer des Mietvertrags angelegt werden.";if(/invalid input syntax for type (numeric|integer|date)/i.test(r))return"Ein eingegebener Betrag oder ein Datum ist ungültig. Bitte prüfen Sie die Eingaben.";if(/row-level security|permission denied|violates row-level/i.test(r))return"Sie haben keine Berechtigung für diese Aktion.";if(/failed to fetch|network request failed|networkerror/i.test(r))return"Verbindungsfehler. Bitte prüfen Sie Ihre Internetverbindung.";let o=r.replace(/(\d+(?:\.\d+)?)\.2f/g,(s,g)=>Ne(Number(g)));return o=o.replace(mt,"…"),o},l=e=>String(e??"").replace(/[&<>"']/g,n=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n]),ut=new Set(["SCRIPT","IFRAME","FRAME","FRAMESET","OBJECT","EMBED","APPLET","LINK","META","BASE","FORM","INPUT","BUTTON","TEXTAREA","SELECT","OPTION","NOSCRIPT","TEMPLATE","SVG","MATH"]),ht=new Set(["href","src","xlink:href","action","formaction","background","poster","srcset","data","lowsrc","dynsrc","ping","cite","longdesc"]),bt=(e,n)=>{const r=String(e||"").replace(/[\u0000- ]+/g,"").toLowerCase();return r.startsWith("javascript:")||r.startsWith("vbscript:")?!1:r.startsWith("data:")?n==="src"&&r.startsWith("data:image/")&&!r.startsWith("data:image/svg"):!0},yt=e=>{if(!e)return"";if(typeof DOMParser>"u")return String(e).replace(/<script[\s\S]*?<\/script>/gi,"");const n=new DOMParser().parseFromString(`<!DOCTYPE html><html><head></head><body>${e}</body></html>`,"text/html"),r=o=>{Array.from(o.childNodes).forEach(s=>{if(s.nodeType===8){s.remove();return}if(s.nodeType===1){if(ut.has(String(s.tagName).toUpperCase())){s.remove();return}Array.from(s.attributes).forEach(g=>{const p=g.name.toLowerCase();(p.startsWith("on")||p==="srcdoc"||p==="formaction"||ht.has(p)&&!bt(g.value,p)||p==="style"&&/expression\s*\(|javascript:|behavior\s*:/i.test(g.value))&&s.removeAttribute(g.name)}),r(s)}})};return r(n.body),n.body.innerHTML},Fe=e=>new Promise(n=>setTimeout(n,e)),a=Ne,ee=ot,Et=e=>e==="Zahlungserinnerung"?1:e==="Abmahnung"||e==="Mahnung"?2:e==="Letzte Zahlungsaufforderung"||e==="dunning_final"?3:0,_t=e=>{const n=Number(e);return e===""||e===null||e===void 0||!Number.isInteger(n)||n<1||n>365?null:n},v=(e,n)=>e.map(r=>(r||"").trim()).filter(Boolean).join(n),Mt=async(e,n,r,o,s,g,p,w,$={})=>{if(!e?.id)throw new Error("Die Forderung ist nicht geladen.");const B=_t(s);if(B===null)throw new Error("Bitte eine gültige Zahlungsfrist angeben (ganze Zahl von 1 bis 365 Tagen).");const f=String(o||"Zahlungserinnerung"),_=[],N=Array.isArray(r)?r:[],{data:c,error:q}=await S.from("profiles").select("first_name, last_name, company, email, phone, bank_name, iban, bic, bank_account_holder").eq("id",e.user_id).maybeSingle();q&&console.warn("Absenderprofil nicht lesbar:",q);const P=e.leases?.units?.properties||{},C=P.portfolio_id;let b=null;if(C){const{data:t,error:i}=await S.from("portfolios").select("company_name, email, phone, bank_name, iban, bic").eq("id",C).maybeSingle();i&&console.warn("Portfolio-Daten nicht lesbar:",i),b=t||null}const Pe=v([c?.first_name,c?.last_name]," "),K=(c?.company||"").trim()||Pe||(b?.company_name||"").trim();if(!K)throw new Error("Absenderangaben fehlen: Bitte hinterlegen Sie Name bzw. Firma im Profil des Eigentümers oder den Firmennamen im Portfolio, bevor ein Mahnschreiben erzeugt wird.");const Ce=v([b?.email||c?.email?`E-Mail: ${b?.email||c?.email}`:"",b?.phone||c?.phone?`Tel.: ${b?.phone||c?.phone}`:""],`
`),E=e.tenants||{},M=v([E.first_name,E.last_name]," "),me=v([E.street,E.house_number]," "),fe=v([E.postal_code,E.city]," "),W=v([P.street,P.house_number]," "),ne=v([P.zip,P.city]," ");let re,ie;if(me&&fe)re=[me,fe],ie="tenant";else if(W||ne)re=[W,ne].filter(Boolean),ie="property",_.push("Für den Mieter ist keine eigene Anschrift hinterlegt – im Schreiben wurde die Objektadresse verwendet. Bei ausgezogenen Mietern bitte die aktuelle Anschrift im Mieterstamm ergänzen.");else throw new Error("Keine Empfängeranschrift vorhanden: Bitte die Anschrift des Mieters im Mieterstamm hinterlegen.");M||_.push("Für den Mieter ist kein Name hinterlegt.");let h="payment_reminder";if(f==="Mahnung")h="dunning_1";else if(f==="Abmahnung")h="dunning_2";else if(f==="Letzte Zahlungsaufforderung"||f==="dunning_final")h="dunning_final";else if(f!=="Zahlungserinnerung"){const t=f.toLowerCase();t.includes("erinnerung")?h="payment_reminder":t.includes("abmahnung")?h="dunning_2":t.includes("letzte")?h="dunning_final":h="dunning_1"}let L=Me[h];try{let t=S.from("document_templates").select("*").eq("type",h);C?t=t.eq("portfolio_id",C):t=t.eq("user_id",e.user_id).is("portfolio_id",null);const{data:i,error:u}=await t.maybeSingle();if(!u&&i)L=i;else if(C){const{data:z}=await S.from("document_templates").select("*").eq("user_id",e.user_id).eq("type",h).is("portfolio_id",null).maybeSingle();z&&(L=z)}}catch(t){console.error("Error fetching template for dunning PDF:",t)}const A=new Date,oe=te(A),R=A.toLocaleDateString("de-DE"),ue=ce(A,B),ae=te(ue);let D=n||null;const{data:he,error:se}=await S.from("claim_totals_view").select("*").eq("claim_id",e.id).maybeSingle();if(!se&&he?D=he:se&&console.warn("claim_totals_view nicht ladbar, verwende geladene Summen:",se),!D)throw new Error("Die Forderungssummen konnten nicht geladen werden. Bitte laden Sie die Seite neu.");const be=F(e.interest_rate??0),G=m(D.current_principal_open),ye=m(D.total_fees_open),Y=m(D.total_interest_open),Le=m(D.total_due),de=m(D.accumulated_unpaid_interest),_e=m(D.live_interest_since_start),Re=m(D.interest_paid),k=e.interest_start_date||null,xe=k?Math.max(0,Be(k,A)):0;let I=N,Q=!1,le=1,d={current_principal_open:G,total_interest_open:Y,total_fees_open:ye,total_due:Le};if(p){const t=N.find(pe=>pe.claim_item_id===p);if(!t)throw new Error("Die gewählte Forderungsposition wurde nicht gefunden. Bitte die Seite neu laden.");I=[t],Q=!0;const i=m(t.open_amount);le=G>0?Math.min(1,i/G):0;const u=m(Y*le),z=m(Math.min(F(t.claim_items?.fee_amount),ye));d={current_principal_open:i,total_interest_open:u,total_fees_open:z,total_due:m(i+u+z)}}if(d.total_due<=0)throw new Error("Für diese Auswahl ist kein Betrag offen – es wird kein Mahnschreiben erzeugt.");const we=I.filter(t=>F(t.open_amount)>0).map(t=>t.claim_items?.due_date||t.claim_items?.period_month).filter(Boolean).map(t=>V(t)).filter(Boolean).sort((t,i)=>t-i),Ie=we.length>0?lt(we[0],A):xe;let x=null;(b?.iban||"").trim()?x={name:b.bank_name,iban:b.iban,bic:b.bic,holder:(b.company_name||"").trim()||K}:(c?.iban||"").trim()&&(x={name:c.bank_name,iban:c.iban,bic:c.bic,holder:(c.bank_account_holder||"").trim()||K});const Oe=`Mahnung-${String(e.id).substring(0,8).toUpperCase()}`,Ue=x?`Inhaber: ${x.holder}, ${x.name?"Bank: "+x.name+", ":""}IBAN: ${x.iban}${x.bic?", BIC: "+x.bic:""}, Verwendungszweck: ${Oe}`:"das Ihnen bekannte Bankkonto";x||_.push("Es ist keine Bankverbindung (IBAN) im Portfolio oder Profil hinterlegt – im Schreiben steht „das Ihnen bekannte Bankkonto“.");const Ze=e.leases?.start_date?ee(e.leases.start_date):"Mietbeginn",je=`
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
    </table>`,De=be.toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:4}),T=[];de!==0&&T.push([k?`Bis zum Zinsstichtag ${ee(k)} bereits berechnete Verzugszinsen`:"Bereits berechnete Verzugszinsen","",k?`bis ${ee(k)}`:"","",a(de)]),k&&T.push([`Laufende Zinsen auf die offene Hauptforderung (${De} % p.a.)`,a(G),`${ee(k)} – ${R}`,String(xe),a(_e)]);const ke=m(de+_e-Y);Re>0&&ke>.004&&T.push(["Abzüglich bereits gezahlter Zinsen","","","",a(-ke)]),T.length===0&&T.push(["Keine Verzugszinsen berechnet","","","",a(0)]);const ze=[`
                <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;">
                    <td colspan="4" style="padding: 6px;">Summe offener Verzugszinsen${Q?" der gesamten Forderung":""}:</td>
                    <td style="padding: 6px; text-align: right;">${a(Y)}</td>
                </tr>`];if(Q){const t=(le*100).toLocaleString("de-DE",{maximumFractionDigits:1});ze.push(`
                <tr style="font-weight: bold;">
                    <td colspan="4" style="padding: 6px;">Davon auf diese Position entfallend (anteilig nach offener Hauptforderung, ${t} %):</td>
                    <td style="padding: 6px; text-align: right;">${a(d.total_interest_open)}</td>
                </tr>`)}const He=`
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
                ${I.map(t=>{const i=m(t.waived_amount??t.waived_principal),u=m(F(t.paid_principal)-i);return`
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px; text-align: left;">${l(t.claim_items?.description||t.claim_items?.item_type||"Forderung")}</td>
                        <td style="padding: 5px; text-align: right;">${a(t.original_amount)}</td>
                        <td style="padding: 5px; text-align: right;">${a(u)}${i>0?`<div style="font-size: 8pt; color: #475569;">Erlass: ${a(i)}</div>`:""}</td>
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
            Der Berechnung liegt ein Zinssatz von ${De} % p.a. zugrunde. Zinstage werden ab dem Tag nach dem Zinsstichtag gezählt.
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
                ${T.map(t=>`
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px; text-align: left;">${t[0]}</td>
                        <td style="padding: 5px; text-align: right;">${t[1]}</td>
                        <td style="padding: 5px; text-align: left;">${t[2]}</td>
                        <td style="padding: 5px; text-align: right;">${t[3]}</td>
                        <td style="padding: 5px; text-align: right; font-weight: bold;">${t[4]}</td>
                    </tr>
                `).join("")}
                ${ze.join("")}
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
    </div>`;let ve="";if(w&&w.token&&w.pin){const t=ct(w.token);try{ve=`
            <div style="margin-top: 15px; margin-bottom: 15px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 12px; text-align: center; font-size: 9.5pt; page-break-inside: avoid;">
                <div style="margin-bottom: 6px;">
                    <img src="${await et.toDataURL(t,{margin:1,width:120})}" style="width: 80px; height: 80px; display: inline-block;" alt="QR Code" />
                </div>
                <div style="font-weight: bold; color: #1e293b; margin-bottom: 4px; font-size: 10pt;">Online Forderungsportal</div>
                <div style="color: #475569; line-height: 1.4; max-width: 480px; margin: 0 auto 6px; font-size: 8.5pt;">
                    Sie können die aktuelle Forderung auch online einsehen und eine Ratenzahlung anfragen. Scannen Sie hierzu den QR-Code und geben Sie den unten genannten Zugangscode ein.
                </div>
                <div style="font-weight: bold; color: #1e293b; font-size: 10pt;">
                    Zugangscode (PIN): <span style="background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${l(w.pin)}</span>
                </div>
            </div>`}catch(i){console.error("Failed to generate QR code for HTML print",i),_.push("Der QR-Code für das Forderungsportal konnte nicht erzeugt werden.")}}const Ve=M?`Sehr geehrte/r ${M}`:"Sehr geehrte Damen und Herren",qe={mieter_name:l(M),mieter_anrede:l(Ve),mieter_adresse:re.map(l).join("<br>"),objekt_name:l(W||"Immobilie"),einheit_name:l(e.leases?.units?.unit_name||"Einheit"),objekt_adresse:l(v([W,ne],", ")),offener_betrag:a(d.total_due),zahlungsfrist_datum:ue.toLocaleDateString("de-DE"),verzugstage:String(Ie),mahnstufe:l(f),zinsbetrag:a(d.total_interest_open),nutzungszeitraum:l(Ze),vermieter_name:l(K),vermieter_kontakt:Ce.split(`
`).map(l).join("<br>"),vermieter_bankverbindung:l(Ue),rechnungsdatum:R,forderungs_tabelle:je+ve,forderungs_detail_tabelle:He},Ke=(t,i)=>{if(!t)return"";let u=t;for(const[z,pe]of Object.entries(i)){const Xe=new RegExp(`(<span[^>]*data-id="${z}"[^>]*>.*?</span>|\\{${z}\\})`,"g");u=u.replace(Xe,()=>pe)}return u},We=rt(L?.content_html||Me[h].content_html),Ge=yt(We).replace(/Sehr geehrte(?:\/r|\(r\))?(?:\s|&nbsp;)*(?=<span[^>]*data-id="mieter_anrede")/gi,"").replace(/Sehr geehrte(?:\/r|\(r\))?(?:\s|&nbsp;)*(?=\{mieter_anrede\})/gi,""),Ye=Ke(Ge,qe),Qe=`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${l(f)} - ${l(M)}</title>
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
    ${Ye}
    </body></html>`,Je=(M||"Mieter").replace(/[^a-z0-9äöüß]/gi,"_").replace(/_+/g,"_").replace(/^_|_$/g,"")||"Mieter",O=`${f.replace(/[^a-z0-9äöüß]/gi,"_").replace(/_+/g,"_")}_Zahlungsverzug_${Je}_${oe}.pdf`,y=document.createElement("iframe");y.setAttribute("aria-hidden","true"),y.tabIndex=-1,y.style.position="absolute",y.style.left="-9999px",y.style.width="210mm",y.style.height="297mm";let U;try{document.body.appendChild(y);const t=y.contentDocument;t.open(),t.write(Qe),t.close();const i=await nt();try{document.fonts&&document.fonts.ready&&await Promise.race([document.fonts.ready,Fe(3e3)])}catch{}await Fe(600),U=await i().set({margin:10,filename:O,image:{type:"jpeg",quality:.98},html2canvas:{scale:2,useCORS:!0},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(t.body).output("arraybuffer")}finally{y.parentNode&&y.parentNode.removeChild(y)}if(!U||!U.byteLength)throw new Error("Das PDF konnte nicht erzeugt werden.");let Se=null;try{const t=await crypto.subtle.digest("SHA-256",U);Se=Array.from(new Uint8Array(t)).map(i=>i.toString(16).padStart(2,"0")).join("")}catch(t){console.warn("SHA-256 nicht berechenbar:",t)}const $e=new Blob([U],{type:"application/pdf"});let J=null;try{const t=O.replace(/[^A-Za-z0-9._-]/g,"_"),i=`${e.id}/${oe}_${Date.now()}_${t}`,{error:u}=await S.storage.from(Te).upload(i,$e,{contentType:"application/pdf",upsert:!1});if(u)throw u;J=i}catch(t){console.warn("PDF konnte nicht archiviert werden:",t),_.push("Das PDF konnte nicht in der App archiviert werden. Bitte legen Sie es selbst ab.")}const Z={document_type:f,document_date:oe,snapshot_date:A.toISOString(),amount_source:"claim_totals_view",principal_snapshot:d.current_principal_open,fees_snapshot:d.total_fees_open,interest_snapshot:d.total_interest_open,total_snapshot:d.total_due,total_due_at_generation:d.total_due,interest_rate:be,deadline:ae,deadline_date:ae,deadline_days:B,document_file_name:O,document_stored:!!J,document_sha256:Se,template_type:h,template_id:L?.id||null,template_updated_at:L?.updated_at||null,recipient_address_source:ie,target_item_id:p||null};J&&(Z.document_bucket=Te,Z.document_storage_path=J),w?.token&&w?.pin&&(Z.portal_access_printed=!0);const{error:j}=await S.from("claim_events").insert([{user_id:e.user_id,claim_id:e.id,event_type:"dunning_sent",description:`${f} erstellt`,event_metadata:Z}]);j&&console.error("Error saving claim_event:",j);const X=URL.createObjectURL($e);let H=!1,Ee=!1;const ge=$?.targetWindow;if(ge&&!ge.closed)try{ge.location.href=X,H=!0}catch(t){console.warn("Vorab geöffnetes Fenster nicht nutzbar:",t)}if(H||(H=!!window.open(X,"_blank")),!H){const t=document.createElement("a");t.href=X,t.download=O,t.rel="noopener",document.body.appendChild(t),t.click(),t.remove(),Ee=!0}return setTimeout(()=>URL.revokeObjectURL(X),300*1e3),{fileName:O,eventMetadata:Z,deadlineDate:ae,warnings:_,historySaved:!j,historyError:j?ft(j):null,opened:H,downloaded:Ee}};export{Te as C,te as a,ct as b,_t as c,Be as d,Mt as e,ot as f,lt as g,Et as h,$t as i,F as n,V as p,m as r,dt as s,ft as t};
