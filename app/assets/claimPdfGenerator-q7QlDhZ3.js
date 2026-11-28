import{s as f}from"./index-DQA7em8L.js";import{Q as tt}from"./browser-B76_ZoHa.js";import{o as nt}from"./fontFaces-DyasV2Ow.js";import{l as rt}from"./htmlToPdf-Cl9-GnRg.js";import{D as Fe,f as it}from"./defaultTemplates-CB0Jqh6V.js";import{s as ot,L as at}from"./letterDocumentCss-CxyoQNjl.js";import{A as st}from"./utilitySettlement-B0oJoZws.js";import"./meterSwap-Dh-UwuxA.js";const dt={},Be=e=>String(e).padStart(2,"0"),R=e=>{const r=typeof e=="number"?e:parseFloat(e);return Number.isFinite(r)?r:0},_=e=>Math.round((R(e)+Number.EPSILON)*100)/100,ne=(e=new Date)=>`${e.getFullYear()}-${Be(e.getMonth()+1)}-${Be(e.getDate())}`,K=e=>{if(!e)return null;if(e instanceof Date)return isNaN(e.getTime())?null:new Date(e.getFullYear(),e.getMonth(),e.getDate());const r=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(e).trim());if(r){const o=new Date(Number(r[1]),Number(r[2])-1,Number(r[3]));return isNaN(o.getTime())?null:o}const n=new Date(e);return isNaN(n.getTime())?null:new Date(n.getFullYear(),n.getMonth(),n.getDate())},me=(e,r)=>{const n=new Date(e.getFullYear(),e.getMonth(),e.getDate());return n.setDate(n.getDate()+r),n},Lt=(e,r)=>{const n=new Date(e.getFullYear(),e.getMonth()+r,1),o=new Date(n.getFullYear(),n.getMonth()+1,0).getDate();return n.setDate(Math.min(e.getDate(),o)),n},Ce=(e,r)=>{const n=K(e),o=K(r);if(!n||!o)return 0;const a=Date.UTC(n.getFullYear(),n.getMonth(),n.getDate()),s=Date.UTC(o.getFullYear(),o.getMonth(),o.getDate());return Math.round((s-a)/864e5)},lt=e=>{const r=K(e);return r?r.toLocaleDateString("de-DE"):""},Ne=e=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(R(e)),ct=e=>{const r=e%19,n=Math.floor(e/100),o=e%100,a=Math.floor(n/4),s=n%4,g=Math.floor((n+8)/25),h=Math.floor((n-g+1)/3),y=(19*r+n-a-h+15)%30,E=Math.floor(o/4),u=o%4,w=(32+2*s+2*E-y-u)%7,A=Math.floor((r+11*y+22*w)/451),l=Math.floor((y+w-7*A+114)/31),z=(y+w-7*A+114)%31+1;return new Date(e,l-1,z)},pt=e=>{const r=e.getFullYear(),n=ne(e),o=ct(r),a=[`${r}-01-01`,`${r}-05-01`,`${r}-10-03`,`${r}-12-25`,`${r}-12-26`],s=[-2,1,39,50].map(g=>ne(me(o,g)));return a.includes(n)||s.includes(n)},gt=e=>{let r=K(e);if(!r)return null;let n=0;for(;(r.getDay()===0||r.getDay()===6||pt(r))&&n<10;)r=me(r,1),n++;return r},ut=(e,r=new Date)=>{const n=gt(e);return n?Math.max(0,Ce(n,r)):0},mt="https://app.immocontrol360.de",ft=()=>{const e=dt?.VITE_PUBLIC_APP_URL;return e&&/^https?:\/\//i.test(e)?e.replace(/\/+$/,""):typeof window<"u"&&!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform())||typeof window>"u"?mt:window.location.origin},ht=e=>`${ft()}/forderung/portal/${encodeURIComponent(e||"")}`,Te="claim-documents",bt=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,_t=(e,r="Die Aktion konnte nicht ausgeführt werden.")=>{const n=String(e?.message||e?.details||(typeof e=="string"?e:"")||"").trim();if(!n)return r;if(/keine Berechtigung/i.test(n))return"Keine Schreibberechtigung für „Finanzen“ in diesem Portfolio (oder der Datensatz ist nicht mehr vorhanden).";if(/invalid input syntax for type (numeric|integer|date)/i.test(n))return"Ein eingegebener Betrag oder ein Datum ist ungültig. Bitte prüfen Sie die Eingaben.";if(/row-level security|permission denied|violates row-level/i.test(n))return"Sie haben keine Berechtigung für diese Aktion.";if(/failed to fetch|network request failed|networkerror/i.test(n))return"Verbindungsfehler. Bitte prüfen Sie Ihre Internetverbindung.";let o=n.replace(/(\d+(?:\.\d+)?)\.2f/g,(a,s)=>Ne(Number(s)));return o=o.replace(bt,"…"),o},yt=(e,r)=>!!e&&(e.code==="PGRST202"||e.code==="42883"||r===404||/could not find the function/i.test(String(e.message||""))),wt="Für diese Forderung läuft ein Ratenplan. Bitte beenden Sie den Ratenplan zuerst in der Forderungsakte (Details), bevor Sie einen Forderungsausfall buchen.",Rt=async({claim:e,reason:r,writeOff:n=!1,userId:o=null})=>{if(!e?.id)throw new Error("Die Forderung ist nicht geladen.");const a=String(r||"").trim();if(!a)throw new Error(n?"Bitte geben Sie einen Grund für den Forderungsausfall an.":"Bitte geben Sie einen Stornierungsgrund an.");const{error:s,status:g}=await f.rpc("cancel_claim",{p_claim_id:e.id,p_reason:a,p_write_off:!!n});if(!s)return{viaRpc:!0,historySaved:!0,historyError:null};if(!yt(s,g))throw s;const h=e.id,y=new Date().toISOString(),{data:E,error:u}=await f.from("payment_plans").select("id").eq("claim_id",h).eq("status","active");if(u)throw u;if(n&&(E||[]).length>0)throw new Error(wt);for(const v of E||[]){const{error:T}=await f.from("payment_plan_installments").update({status:"cancelled",updated_at:y}).eq("payment_plan_id",v.id).in("status",["open","partial","overdue"]);let p=T;if(!p){const{error:P}=await f.from("payment_plans").update({status:"cancelled",cancelled_at:y,cancelled_by:o,cancellation_reason:a,updated_at:y}).eq("id",v.id);p=P}if(p){if(/Ratenpläne können nur über/i.test(String(p.message||""))){const{error:P}=await f.rpc("reverse_payment_plan",{p_claim_id:h});if(P&&!String(P.message||"").includes("Kein aktiver Ratenplan"))throw P;break}throw p}}const{data:w,error:A}=await f.from("claims").update({status:"cancelled",cancelled_at:y,cancelled_by:o,cancellation_reason:n?`Forderungsausfall: ${a}`:a,updated_at:y}).eq("id",h).select("id");if(A)throw A;if(!w||w.length===0)throw new Error("Forderung nicht gefunden oder keine Berechtigung.");const{error:l}=await f.from("claim_access_links").update({is_active:!1,revoked_at:y}).eq("claim_id",h).eq("is_active",!0);l&&console.warn("Portal-Link konnte nicht deaktiviert werden:",l);const{error:z}=await f.from("claim_events").insert([{user_id:e.user_id||o,claim_id:h,event_type:n?"status_changed":"cancelled",description:n?"Forderungsausfall gebucht":"Forderung storniert",event_metadata:{old_status:e.status,new_status:"cancelled",reason:a,write_off:!!n,cancelled_payment_plan_ids:(E||[]).map(v=>v.id)}}]);return z&&console.warn("Storno-Ereignis konnte nicht gespeichert werden:",z),{viaRpc:!1,historySaved:!z,historyError:z||null}},m=e=>String(e??"").replace(/[&<>"']/g,r=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[r]),xt=new Set(["SCRIPT","IFRAME","FRAME","FRAMESET","OBJECT","EMBED","APPLET","LINK","META","BASE","FORM","INPUT","BUTTON","TEXTAREA","SELECT","OPTION","NOSCRIPT","TEMPLATE","SVG","MATH"]),kt=new Set(["href","src","xlink:href","action","formaction","background","poster","srcset","data","lowsrc","dynsrc","ping","cite","longdesc"]),vt=(e,r)=>{const n=String(e||"").replace(/[\u0000- ]+/g,"").toLowerCase();return n.startsWith("javascript:")||n.startsWith("vbscript:")?!1:n.startsWith("data:")?r==="src"&&n.startsWith("data:image/")&&!n.startsWith("data:image/svg"):!0},St=e=>{if(!e)return"";if(typeof DOMParser>"u")return String(e).replace(/<script[\s\S]*?<\/script>/gi,"");const r=new DOMParser().parseFromString(`<!DOCTYPE html><html><head></head><body>${e}</body></html>`,"text/html"),n=o=>{Array.from(o.childNodes).forEach(a=>{if(a.nodeType===8){a.remove();return}if(a.nodeType===1){if(xt.has(String(a.tagName).toUpperCase())){a.remove();return}Array.from(a.attributes).forEach(s=>{const g=s.name.toLowerCase();(g.startsWith("on")||g==="srcdoc"||g==="formaction"||kt.has(g)&&!vt(s.value,g)||g==="style"&&/expression\s*\(|javascript:|behavior\s*:/i.test(s.value))&&a.removeAttribute(s.name)}),n(a)}})};return n(r.body),r.body.innerHTML},Pe=e=>new Promise(r=>setTimeout(r,e)),Dt=`
.ic-claim-doc { width: 210mm; background: #ffffff; color: #000000; text-align: left; font-weight: 400; }
${ot(at,".ic-claim-doc")}
.ic-claim-doc .letter-page { height: 296mm !important; min-height: 296mm !important; max-height: 296mm !important; padding-bottom: 34mm !important; margin: 0 !important; box-shadow: none !important; border-radius: 0 !important; page-break-inside: avoid; break-inside: avoid; }
.ic-claim-doc .letter-page ~ .letter-page { page-break-before: always; break-before: page; }
.ic-claim-doc > p:empty { display: none; }
.ic-claim-doc table { background: transparent !important; box-shadow: none !important; border-radius: 0 !important; overflow: visible !important; border: none; }
.ic-claim-doc th, .ic-claim-doc td { color: #000000; background-color: transparent; font-size: inherit; border: revert; }
.ic-claim-doc th { font-weight: bold; }
`,d=Ne,te=lt,It=e=>e==="Zahlungserinnerung"?1:e==="Abmahnung"||e==="Mahnung"?2:e==="Letzte Zahlungsaufforderung"||e==="dunning_final"?3:0,Et=e=>{const r=Number(e);return e===""||e===null||e===void 0||!Number.isInteger(r)||r<1||r>365?null:r},B=(e,r)=>e.map(n=>(n||"").trim()).filter(Boolean).join(r),Ut=async(e,r,n,o,a,s,g,h,y={})=>{if(!e?.id)throw new Error("Die Forderung ist nicht geladen.");const E=Et(a);if(E===null)throw new Error("Bitte eine gültige Zahlungsfrist angeben (ganze Zahl von 1 bis 365 Tagen).");const u=String(o||"Zahlungserinnerung"),w=[],A=Array.isArray(n)?n:[],{data:l,error:z}=await f.from("profiles").select("first_name, last_name, company, email, phone, bank_name, iban, bic, bank_account_holder").eq("id",e.user_id).maybeSingle();z&&console.warn("Absenderprofil nicht lesbar:",z);const v=e.leases?.units?.properties||{},T=v.portfolio_id;let p=null;if(T){const{data:t,error:i}=await f.from("portfolios").select("company_name, email, phone, bank_name, iban, bic").eq("id",T).maybeSingle();i&&console.warn("Portfolio-Daten nicht lesbar:",i),p=t||null}const P=B([l?.first_name,l?.last_name]," "),G=(l?.company||"").trim()||P||(p?.company_name||"").trim();if(!G)throw new Error("Absenderangaben fehlen: Bitte hinterlegen Sie Name bzw. Firma im Profil des Eigentümers oder den Firmennamen im Portfolio, bevor ein Mahnschreiben erzeugt wird.");const Le=B([p?.email||l?.email?`E-Mail: ${p?.email||l?.email}`:"",p?.phone||l?.phone?`Tel.: ${p?.phone||l?.phone}`:""],`
`),M=e.tenants||{},I=B([M.first_name,M.last_name]," "),fe=B([M.street,M.house_number]," "),he=B([M.postal_code,M.city]," "),W=B([v.street,v.house_number]," "),re=B([v.zip,v.city]," ");let ie,oe;if(fe&&he)ie=[fe,he],oe="tenant";else if(W||re)ie=[W,re].filter(Boolean),oe="property",w.push("Für den Mieter ist keine eigene Anschrift hinterlegt – im Schreiben wurde die Objektadresse verwendet. Bei ausgezogenen Mietern bitte die aktuelle Anschrift im Mieterstamm ergänzen.");else throw new Error("Keine Empfängeranschrift vorhanden: Bitte die Anschrift des Mieters im Mieterstamm hinterlegen.");I||w.push("Für den Mieter ist kein Name hinterlegt.");let ae=M.salutation;if(ae===void 0&&e.tenant_id){const{data:t,error:i}=await f.from("tenants").select("salutation").eq("id",e.tenant_id).maybeSingle();i&&console.warn("Anrede des Mieters nicht lesbar – neutrale Briefanrede:",i),ae=t?.salutation??null}let x="payment_reminder";if(u==="Mahnung")x="dunning_1";else if(u==="Abmahnung")x="dunning_2";else if(u==="Letzte Zahlungsaufforderung"||u==="dunning_final")x="dunning_final";else if(u!=="Zahlungserinnerung"){const t=u.toLowerCase();t.includes("erinnerung")?x="payment_reminder":t.includes("abmahnung")?x="dunning_2":t.includes("letzte")?x="dunning_final":x="dunning_1"}let U=Fe[x];try{let t=f.from("document_templates").select("*").eq("type",x);T?t=t.eq("portfolio_id",T):t=t.eq("user_id",e.user_id).is("portfolio_id",null);const{data:i,error:b}=await t.maybeSingle();if(!b&&i)U=i;else if(T){const{data:D}=await f.from("document_templates").select("*").eq("user_id",e.user_id).eq("type",x).is("portfolio_id",null).maybeSingle();D&&(U=D)}}catch(t){console.error("Error fetching template for dunning PDF:",t)}const C=new Date,se=ne(C),O=C.toLocaleDateString("de-DE"),be=me(C,E),de=ne(be);let $=r||null;const{data:_e,error:le}=await f.from("claim_totals_view").select("*").eq("claim_id",e.id).maybeSingle();if(!le&&_e?$=_e:le&&console.warn("claim_totals_view nicht ladbar, verwende geladene Summen:",le),!$)throw new Error("Die Forderungssummen konnten nicht geladen werden. Bitte laden Sie die Seite neu.");const ye=R(e.interest_rate??0),Y=_($.current_principal_open),we=_($.total_fees_open),Q=_($.total_interest_open),Re=_($.total_due),ce=_($.accumulated_unpaid_interest),xe=_($.live_interest_since_start),Ie=_($.interest_paid),F=e.interest_start_date||null,ke=F?Math.max(0,Ce(F,C)):0;let Z=A,X=!1,pe=1,c={current_principal_open:Y,total_interest_open:Q,total_fees_open:we,total_due:Re};if(g){const t=A.find(ue=>ue.claim_item_id===g);if(!t)throw new Error("Die gewählte Forderungsposition wurde nicht gefunden. Bitte die Seite neu laden.");Z=[t],X=!0;const i=_(t.open_amount);pe=Y>0?Math.min(1,i/Y):0;const b=_(Q*pe),D=_(Math.min(R(t.claim_items?.fee_amount),we));c={current_principal_open:i,total_interest_open:b,total_fees_open:D,total_due:_(i+b+D)}}if(c.total_due<=0)throw new Error("Für diese Auswahl ist kein Betrag offen – es wird kein Mahnschreiben erzeugt.");const ve=Z.filter(t=>R(t.open_amount)>0).map(t=>t.claim_items?.due_date||t.claim_items?.period_month).filter(Boolean).map(t=>K(t)).filter(Boolean).sort((t,i)=>t-i),Ue=ve.length>0?ut(ve[0],C):ke;let S=null;(p?.iban||"").trim()?S={name:p.bank_name,iban:p.iban,bic:p.bic,holder:(p.company_name||"").trim()||G}:(l?.iban||"").trim()&&(S={name:l.bank_name,iban:l.iban,bic:l.bic,holder:(l.bank_account_holder||"").trim()||G});const Oe=`Mahnung-${String(e.id).substring(0,8).toUpperCase()}`,Ze=S?`Inhaber: ${S.holder}, ${S.name?"Bank: "+S.name+", ":""}IBAN: ${S.iban}${S.bic?", BIC: "+S.bic:""}, Verwendungszweck: ${Oe}`:"das Ihnen bekannte Bankkonto";S||w.push(l?"Es ist keine Bankverbindung (IBAN) im Portfolio oder Profil hinterlegt – im Schreiben steht „das Ihnen bekannte Bankkonto“.":"Im Portfolio ist keine Bankverbindung (IBAN) hinterlegt – im Schreiben steht „das Ihnen bekannte Bankkonto“. Das Forderungsportal nennt ggf. die Bankverbindung aus dem Profil des Eigentümers; bitte die IBAN im Portfolio hinterlegen lassen.");const qe=e.leases?.start_date?te(e.leases.start_date):"Mietbeginn",He=`
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10pt;">
        <thead>
            <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                <th style="padding: 6px; text-align: left;">Forderungsposition</th>
                <th style="padding: 6px; text-align: right; width: 30%;">Betrag</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">${X?m(Z[0].claim_items?.description||Z[0].claim_items?.item_type||"Hauptforderung"):"Offene Hauptforderungen (Miete/Nebenkosten etc.)"}</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${d(c.current_principal_open)}</td>
            </tr>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Verzugszinsen bis einschließlich ${O}</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${d(c.total_interest_open)}</td>
            </tr>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Mahnkosten / Auslagen</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${d(c.total_fees_open)}</td>
            </tr>
            <tr style="border-top: 2px solid #000; border-bottom: 2px double #000; background-color: #f8fafc;">
                <td style="padding: 8px; font-weight: bold; font-size: 11pt;">Gesamtforderung zum ${O}:</td>
                <td style="padding: 8px; text-align: right; font-weight: bold; font-size: 11pt; color: #dc2626;">${d(c.total_due)}</td>
            </tr>
        </tbody>
    </table>`,Se=ye.toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:4}),N=[];ce!==0&&N.push([F?`Bis zum Zinsstichtag ${te(F)} bereits berechnete Verzugszinsen`:"Bereits berechnete Verzugszinsen","",F?`bis ${te(F)}`:"","",d(ce)]),F&&N.push([`Laufende Zinsen auf die offene Hauptforderung (${Se} % p.a.)`,d(Y),`${te(F)} – ${O}`,String(ke),d(xe)]);const De=_(ce+xe-Q);Ie>0&&De>.004&&N.push(["Abzüglich bereits gezahlter Zinsen","","","",d(-De)]),N.length===0&&N.push(["Keine Verzugszinsen berechnet","","","",d(0)]);const Ee=[`
                <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;">
                    <td colspan="4" style="padding: 6px;">Summe offener Verzugszinsen${X?" der gesamten Forderung":""}:</td>
                    <td style="padding: 6px; text-align: right;">${d(Q)}</td>
                </tr>`];if(X){const t=(pe*100).toLocaleString("de-DE",{maximumFractionDigits:1});Ee.push(`
                <tr style="font-weight: bold;">
                    <td colspan="4" style="padding: 6px;">Davon auf diese Position entfallend (anteilig nach offener Hauptforderung, ${t} %):</td>
                    <td style="padding: 6px; text-align: right;">${d(c.total_interest_open)}</td>
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
                ${Z.map(t=>{const i=_(t.waived_amount??t.waived_principal),b=_(R(t.paid_principal)-i);return`
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px; text-align: left;">${m(t.claim_items?.description||t.claim_items?.item_type||"Forderung")}</td>
                        <td style="padding: 5px; text-align: right;">${d(t.original_amount)}</td>
                        <td style="padding: 5px; text-align: right;">${d(b)}${i>0?`<div style="font-size: 8pt; color: #475569;">Erlass: ${d(i)}</div>`:""}</td>
                        <td style="padding: 5px; text-align: right; font-weight: bold;">${d(t.open_amount)}</td>
                    </tr>
                `}).join("")}
                <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;">
                    <td style="padding: 6px;">Summe offener Hauptforderungen:</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 6px; text-align: right;">${d(c.current_principal_open)}</td>
                </tr>
                <tr>
                    <td style="padding: 5px;">Mahnkosten / Auslagen (offen)</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 5px; text-align: right;">${d(c.total_fees_open)}</td>
                </tr>
                <tr>
                    <td style="padding: 5px;">Verzugszinsen (offen, siehe Anlage 2)</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 5px; text-align: right;">${d(c.total_interest_open)}</td>
                </tr>
                <tr style="border-top: 1px solid #000; font-weight: bold;">
                    <td style="padding: 6px;">Gesamtforderung zum ${O}:</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 6px; text-align: right;">${d(c.total_due)}</td>
                </tr>
            </tbody>
        </table>

        <h3 style="font-size: 11pt; font-weight: bold; margin-top: 15px; margin-bottom: 4px; border-bottom: 1px solid #000; padding-bottom: 2px;">Anlage 2: Zinsberechnung</h3>
        <p style="font-size: 8.5pt; color: #475569; margin-bottom: 8px;">
            Nach § 288 Abs. 1 BGB können Verzugszinsen in Höhe von fünf Prozentpunkten über dem jeweiligen Basiszinssatz verlangt werden.
            Der Berechnung liegt ein Zinssatz von ${Se} % p.a. zugrunde. Zinstage werden ab dem Tag nach dem Zinsstichtag gezählt.
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
                ${N.map(t=>`
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px; text-align: left;">${t[0]}</td>
                        <td style="padding: 5px; text-align: right;">${t[1]}</td>
                        <td style="padding: 5px; text-align: left;">${t[2]}</td>
                        <td style="padding: 5px; text-align: right;">${t[3]}</td>
                        <td style="padding: 5px; text-align: right; font-weight: bold;">${t[4]}</td>
                    </tr>
                `).join("")}
                ${Ee.join("")}
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
    </div>`;let ze="";if(h&&h.token&&h.pin){const t=ht(h.token);try{ze=`
            <div style="margin-top: 15px; margin-bottom: 15px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 12px; text-align: center; font-size: 9.5pt; page-break-inside: avoid;">
                <div style="margin-bottom: 6px;">
                    <img src="${await tt.toDataURL(t,{margin:1,width:120})}" style="width: 80px; height: 80px; display: inline-block;" alt="QR Code" />
                </div>
                <div style="font-weight: bold; color: #1e293b; margin-bottom: 4px; font-size: 10pt;">Online Forderungsportal</div>
                <div style="color: #475569; line-height: 1.4; max-width: 480px; margin: 0 auto 6px; font-size: 8.5pt;">
                    Sie können die aktuelle Forderung auch online einsehen und eine Ratenzahlung anfragen. Scannen Sie hierzu den QR-Code und geben Sie den unten genannten Zugangscode ein.
                </div>
                <div style="font-weight: bold; color: #1e293b; font-size: 10pt;">
                    Zugangscode (PIN): <span style="background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${m(h.pin)}</span>
                </div>
            </div>`}catch(i){console.error("Failed to generate QR code for HTML print",i),w.push("Der QR-Code für das Forderungsportal konnte nicht erzeugt werden.")}}const je=st({fullName:I,lastName:M.last_name,salutation:ae}),Ke={mieter_name:m(I),mieter_anrede:m(je),mieter_adresse:ie.map(m).join("<br>"),objekt_name:m(W||"Immobilie"),einheit_name:m(e.leases?.units?.unit_name||"Einheit"),objekt_adresse:m(B([W,re],", ")),offener_betrag:d(c.total_due),zahlungsfrist_datum:be.toLocaleDateString("de-DE"),verzugstage:String(Ue),mahnstufe:m(u),zinsbetrag:d(c.total_interest_open),nutzungszeitraum:m(qe),vermieter_name:m(G),vermieter_kontakt:Le.split(`
`).map(m).join("<br>"),vermieter_bankverbindung:m(Ze),rechnungsdatum:O,forderungs_tabelle:He+ze,forderungs_detail_tabelle:Ve},Ge=(t,i)=>{if(!t)return"";let b=t;for(const[D,ue]of Object.entries(i)){const et=new RegExp(`(<span[^>]*data-id="${D}"[^>]*>.*?</span>|\\{${D}\\})`,"g");b=b.replace(et,()=>ue)}return b},We=it(U?.content_html||Fe[x].content_html),Ye=St(We).replace(/Sehr geehrte(?:\/r|\(r\)|r)?(?:\s|&nbsp;)*(?=<span[^>]*data-id="mieter_anrede")/gi,"").replace(/Sehr geehrte(?:\/r|\(r\)|r)?(?:\s|&nbsp;)*(?=\{mieter_anrede\})/gi,""),Qe=Ge(Ye,Ke),Xe=`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${m(u)} - ${m(I)}</title>
    <style>${nt()} @page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; background: #ffffff; }</style>
    </head><body style="background:#fff"><div class="ic-claim-doc"><style>${Dt}</style>${Qe}</div></body></html>`,Je=(I||"Mieter").replace(/[^a-z0-9äöüß]/gi,"_").replace(/_+/g,"_").replace(/^_|_$/g,"")||"Mieter",q=`${u.replace(/[^a-z0-9äöüß]/gi,"_").replace(/_+/g,"_")}_Zahlungsverzug_${Je}_${se}.pdf`,k=document.createElement("iframe");k.setAttribute("aria-hidden","true"),k.tabIndex=-1,k.style.position="absolute",k.style.left="-9999px",k.style.width="210mm",k.style.height="297mm";let H;try{document.body.appendChild(k);const t=k.contentDocument;t.open(),t.write(Xe),t.close();const i=await rt();try{if(document.fonts&&document.fonts.ready){const b=typeof document.fonts.load=="function"?Promise.all(['400 11pt "Open Sans"','600 11pt "Open Sans"','700 11pt "Open Sans"'].map(D=>document.fonts.load(D))).then(()=>document.fonts.ready):document.fonts.ready;await Promise.race([b,Pe(3e3)])}}catch{}await Pe(600),H=await i().set({margin:0,filename:q,image:{type:"jpeg",quality:.98},html2canvas:{scale:2,useCORS:!0,backgroundColor:"#ffffff",scrollX:0,scrollY:0},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},pagebreak:{mode:["css"]}}).from(t.querySelector(".ic-claim-doc")||t.body).output("arraybuffer")}finally{k.parentNode&&k.parentNode.removeChild(k)}if(!H||!H.byteLength)throw new Error("Das PDF konnte nicht erzeugt werden.");let $e=null;try{const t=await crypto.subtle.digest("SHA-256",H);$e=Array.from(new Uint8Array(t)).map(i=>i.toString(16).padStart(2,"0")).join("")}catch(t){console.warn("SHA-256 nicht berechenbar:",t)}const Ae=new Blob([H],{type:"application/pdf"});let J=null;try{const t=q.replace(/[^A-Za-z0-9._-]/g,"_"),i=`${e.id}/${se}_${Date.now()}_${t}`,{error:b}=await f.storage.from(Te).upload(i,Ae,{contentType:"application/pdf",upsert:!1});if(b)throw b;J=i}catch(t){console.warn("PDF konnte nicht archiviert werden:",t),w.push("Das PDF konnte nicht in der App archiviert werden. Bitte legen Sie es selbst ab.")}const L={document_type:u,document_date:se,snapshot_date:C.toISOString(),amount_source:"claim_totals_view",principal_snapshot:c.current_principal_open,fees_snapshot:c.total_fees_open,interest_snapshot:c.total_interest_open,total_snapshot:c.total_due,total_due_at_generation:c.total_due,interest_rate:ye,deadline:de,deadline_date:de,deadline_days:E,document_file_name:q,document_stored:!!J,document_sha256:$e,template_type:x,template_id:U?.id||null,template_updated_at:U?.updated_at||null,recipient_address_source:oe,target_item_id:g||null};J&&(L.document_bucket=Te,L.document_storage_path=J),h?.token&&h?.pin&&(L.portal_access_printed=!0),s&&(L.note=String(s));const{error:V}=await f.from("claim_events").insert([{user_id:e.user_id,claim_id:e.id,event_type:"dunning_sent",description:`${u} erstellt`,event_metadata:L}]);V&&console.error("Error saving claim_event:",V);const ee=URL.createObjectURL(Ae);let j=!1,Me=!1;const ge=y?.targetWindow;if(ge&&!ge.closed)try{ge.location.href=ee,j=!0}catch(t){console.warn("Vorab geöffnetes Fenster nicht nutzbar:",t)}if(j||(j=!!window.open(ee,"_blank")),!j){const t=document.createElement("a");t.href=ee,t.download=q,t.rel="noopener",document.body.appendChild(t),t.click(),t.remove(),Me=!0}return setTimeout(()=>URL.revokeObjectURL(ee),300*1e3),{fileName:q,eventMetadata:L,deadlineDate:de,warnings:w,historySaved:!V,historyError:V?_t(V):null,opened:j,downloaded:Me}};export{Te as CLAIM_DOCUMENT_BUCKET,wt as WRITE_OFF_ACTIVE_PLAN_MESSAGE,me as addDays,Lt as addMonthsClamped,ht as buildClaimPortalUrl,Rt as cancelClaim,Ce as daysBetween,m as escapeHtml,Ne as formatCurrencyDE,lt as formatDateDE,Ut as generateClaimPdf,ut as getDelayDays,It as getDunningLevel,ft as getPublicAppOrigin,yt as isMissingRpcError,R as num,Et as parseDeadlineDays,K as parseLocalDate,_ as round2,St as sanitizeTemplateHtml,gt as shiftToBusinessDay,ne as toLocalDateString,_t as translateClaimError};
