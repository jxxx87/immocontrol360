import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── German number formatting ────────────────────────────────────────
const fmtCurrency = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })
const fmtArea = (v: number) => `${v.toLocaleString('de-DE', { minimumFractionDigits: 1 })} m²`
const fmtPercent = (v: number) => `${(v * 100).toLocaleString('de-DE', { minimumFractionDigits: 1 })} %`
const fmtDecimal = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2 })
const fmtDate = (v: string) => v ? new Date(v).toLocaleDateString('de-DE') : '–'
const fmtValue = (v: any, format: string) => {
    if (v === null || v === undefined) return '–'
    switch (format) {
        case 'currency': return fmtCurrency(Number(v))
        case 'area': return fmtArea(Number(v))
        case 'percent': return fmtPercent(Number(v))
        case 'decimal': return fmtDecimal(Number(v))
        case 'date': return fmtDate(String(v))
        default: return String(v)
    }
}

// ── Column definitions per report type (mirrors frontend) ───────────
const COLUMN_DEFS: Record<string, Record<string, { label: string; format?: string }>> = {
    immobilien: {
        adresse: { label: 'Straße + Hausnr.' },
        einheiten: { label: 'Einheiten' },
        kaufpreis: { label: 'Kaufpreis', format: 'currency' },
        marktpreis: { label: 'Marktpreis', format: 'currency' },
        restschuld: { label: 'Restschuld', format: 'currency' },
        miete_monat: { label: 'Miete (Monat)', format: 'currency' },
        cashflow_monat: { label: 'Cashflow (Monat)', format: 'currency' },
        wohnflaeche: { label: 'Wohnfläche', format: 'area' },
        leerstand: { label: 'Leerstand' },
        ltv: { label: 'LTV', format: 'percent' },
        dscr: { label: 'DSCR', format: 'decimal' },
    },
    mietverhaeltnisse: {
        mietername: { label: 'Mieter' },
        immobilie_einheit: { label: 'Immobilie + Einheit' },
        kaltmiete: { label: 'Kaltmiete', format: 'currency' },
        nebenkosten: { label: 'Nebenkosten', format: 'currency' },
        warmmiete: { label: 'Warmmiete', format: 'currency' },
        mietbeginn: { label: 'Mietbeginn', format: 'date' },
        wohnflaeche: { label: 'Wohnfläche', format: 'area' },
        kaution: { label: 'Kaution', format: 'currency' },
        status: { label: 'Status' },
        zahlstatus: { label: 'Zahlstatus' },
    },
    kpi: {
        mieteinnahmen_monat: { label: 'Mieteinnahmen (Monat)', format: 'currency' },
        cashflow_monat: { label: 'Cashflow (Monat)', format: 'currency' },
        restschuld_gesamt: { label: 'Restschuld gesamt', format: 'currency' },
        dscr_avg: { label: 'DSCR Ø', format: 'decimal' },
        ltv_avg: { label: 'LTV Ø', format: 'percent' },
        leerstand_pct: { label: 'Leerstand %', format: 'percent' },
    },
    bankaufstellung: {
        objekt: { label: 'Objekt' },
        kaufpreis: { label: 'Kaufpreis', format: 'currency' },
        marktpreis: { label: 'Marktpreis', format: 'currency' },
        restschuld: { label: 'Restschuld', format: 'currency' },
        miete_monat: { label: 'Miete (Monat)', format: 'currency' },
        cashflow_monat: { label: 'Cashflow (Monat)', format: 'currency' },
        dscr: { label: 'DSCR', format: 'decimal' },
        einheiten: { label: 'Einheiten' },
        wohnflaeche: { label: 'Wohnfläche', format: 'area' },
        leerstand: { label: 'Leerstand' },
        ltv: { label: 'LTV', format: 'percent' },
    },
    offene_mieten: {
        mieter: { label: 'Mieter' },
        immobilie_einheit: { label: 'Immobilie + Einheit' },
        offen_gesamt: { label: 'Offen gesamt', format: 'currency' },
        aeltester_monat: { label: 'Ältester offener Monat' },
        offene_monate: { label: 'Offene Monate' },
        letzte_zahlung: { label: 'Letzte Zahlung' },
        warmmiete: { label: 'Warmmiete (Monat)', format: 'currency' },
    },
    buchhaltung: {
        datum: { label: 'Datum', format: 'date' },
        empfaenger: { label: 'Empfänger/Absender' },
        verwendungszweck: { label: 'Verwendungszweck' },
        betrag: { label: 'Betrag', format: 'currency' },
        kategorie: { label: 'Kategorie' },
        immobilie: { label: 'Immobilie' },
        rechnung: { label: 'Rechnung' },
    },
    deals: {
        dealname: { label: 'Dealname' },
        kaufpreis: { label: 'Kaufpreis', format: 'currency' },
        ek: { label: 'EK', format: 'currency' },
        rendite: { label: 'Rendite', format: 'percent' },
        cashflow: { label: 'Cashflow', format: 'currency' },
        dscr: { label: 'DSCR', format: 'decimal' },
        status: { label: 'Status' },
        sanierungsbudget: { label: 'Sanierungsbudget', format: 'currency' },
        exit_preis: { label: 'Exit-Preis', format: 'currency' },
    },
    sanierung: {
        projekt: { label: 'Projekt' },
        objekt: { label: 'Objekt' },
        budget_soll: { label: 'Budget Soll', format: 'currency' },
        ist_bezahlt: { label: 'Ist bezahlt', format: 'currency' },
        fortschritt: { label: 'Fortschritt %', format: 'percent' },
        ziel_enddatum: { label: 'Ziel-Enddatum', format: 'date' },
        offene_aufgaben: { label: 'Offene Aufgaben' },
    },
    sanierung_rechner: {
        gewerk: { label: 'Gewerk' },
        summe: { label: 'Summe', format: 'currency' },
    },
    mahnwesen: {
        mietername: { label: 'Mieter' },
        immobilie: { label: 'Immobilie' },
        ursprung: { label: 'Ursprung', format: 'currency' },
        offen: { label: 'Offener Betrag', format: 'currency' },
        status: { label: 'Status' },
        frist: { label: 'Zahlungsfrist', format: 'date' },
        gebuehren: { label: 'Mahngebühren', format: 'currency' },
        zinsen: { label: 'Verzugszinsen', format: 'currency' },
        erstellt_am: { label: 'Erstellt am', format: 'date' },
    },
}

// ── Report title map ────────────────────────────────────────────────
const REPORT_TITLES: Record<string, string> = {
    immobilien: 'Immobilienübersicht',
    mietverhaeltnisse: 'Mietverhältnisse',
    kpi: 'KPI Summary',
    bankaufstellung: 'Bankaufstellung',
    offene_mieten: 'Offene Mieten',
    buchhaltung: 'Buchhaltungsreport',
    deals: 'Deal-Übersicht',
    sanierung: 'Sanierungsprojekte',
    sanierung_rechner: 'Sanierungsrechner',
    mahnwesen: 'Mahnwesen & Forderungen',
}

// ── Data fetching per report type ───────────────────────────────────
async function fetchReportData(
    supabase: any,
    reportType: string,
    portfolioId: string,
    opts: any
) {
    const rows: Record<string, any>[] = []

    switch (reportType) {
        case 'immobilien': {
            let q = supabase
                .from('properties')
                .select(`*, units(id, sqm, target_rent, leases(cold_rent, status)), loans(remaining_balance)`)
                .eq('portfolio_id', portfolioId)
                .order('street')

            if (opts.property_id) q = q.eq('id', opts.property_id)

            const { data } = await q
            for (const p of data || []) {
                const units = p.units || []
                const totalUnits = units.length
                const sqm = units.reduce((s: number, u: any) => s + (u.sqm || 0), 0)
                const rent = units.reduce((s: number, u: any) => {
                    const a = u.leases?.find((l: any) => l.status === 'active')
                    return s + (a?.cold_rent || 0)
                }, 0)
                const restschuld = (p.loans || []).reduce((s: number, l: any) => s + (l.remaining_balance || 0), 0)
                const kaufpreis = p.total_investment_cost || 0
                const marktpreis = p.market_value || kaufpreis
                const cashflow = rent - (p.monthly_loan_payment || 0)
                const ltv = marktpreis > 0 ? restschuld / marktpreis : 0
                const dscr = (p.monthly_loan_payment || 0) > 0 ? rent / p.monthly_loan_payment : 0
                const vacant = units.filter((u: any) => !u.leases?.some((l: any) => l.status === 'active')).length

                rows.push({
                    adresse: `${p.street} ${p.house_number}`,
                    einheiten: totalUnits,
                    kaufpreis, marktpreis, restschuld,
                    miete_monat: rent,
                    cashflow_monat: cashflow,
                    wohnflaeche: sqm,
                    leerstand: `${vacant}/${totalUnits}`,
                    ltv, dscr,
                    _property_id: p.id,
                    _property_label: `${p.street} ${p.house_number}`,
                })
            }
            break
        }
        case 'mietverhaeltnisse': {
            let q = supabase
                .from('leases')
                .select(`*, tenant:tenants(*), unit:units(*, property:properties(*))`)
                .eq('unit.property.portfolio_id', portfolioId)
                .order('start_date', { ascending: false })

            const { data } = await q
            let idx = 0
            for (const l of data || []) {
                if (!l.unit?.property || l.unit.property.portfolio_id !== portfolioId) continue
                const t = l.tenant
                idx++
                const name = opts.dsgvo_anonymize ? `Mieter ${String.fromCharCode(64 + idx)}` : `${t?.first_name || ''} ${t?.last_name || ''}`.trim()
                rows.push({
                    mietername: name || '–',
                    immobilie_einheit: `${l.unit.property.street} ${l.unit.property.house_number} / ${l.unit.unit_name || ''}`,
                    kaltmiete: l.cold_rent || 0,
                    nebenkosten: (l.service_charge || 0) + (l.heating_cost || 0),
                    warmmiete: (l.cold_rent || 0) + (l.service_charge || 0) + (l.heating_cost || 0),
                    mietbeginn: l.start_date,
                    wohnflaeche: l.unit.sqm || 0,
                    kaution: l.deposit || 0,
                    status: l.status === 'active' ? 'Aktiv' : l.status,
                    zahlstatus: '–',
                    _property_id: l.unit.property.id,
                    _property_label: `${l.unit.property.street} ${l.unit.property.house_number}`,
                })
            }
            break
        }
        case 'buchhaltung': {
            let q = supabase
                .from('transactions')
                .select(`*, property:properties(street, house_number)`)
                .eq('portfolio_id', portfolioId)
                .order('date', { ascending: false })

            if (opts.property_id) q = q.eq('property_id', opts.property_id)

            const { data } = await q
            for (const t of data || []) {
                const zweck = t.description || t.reference || ''
                rows.push({
                    datum: t.date,
                    empfaenger: t.counterpart_name || '–',
                    verwendungszweck: zweck.substring(0, 40),
                    betrag: t.amount || 0,
                    kategorie: t.category || '–',
                    immobilie: t.property ? `${t.property.street} ${t.property.house_number}` : '–',
                    rechnung: t.invoice_id ? 'Ja' : '–',
                    _type: t.amount >= 0 ? 'income' : 'expense',
                    _property_id: t.property_id,
                    _property_label: t.property ? `${t.property.street} ${t.property.house_number}` : null,
                })
            }
            break
        }
        case 'deals': {
            const { data } = await supabase
                .from('deals')
                .select('*')
                .eq('portfolio_id', portfolioId)
                .order('created_at', { ascending: false })

            for (const d of data || []) {
                rows.push({
                    dealname: d.name || d.title || '–',
                    kaufpreis: d.purchase_price || 0,
                    ek: d.equity || 0,
                    rendite: d.yield_percent || 0,
                    cashflow: d.monthly_cashflow || 0,
                    dscr: d.dscr || 0,
                    status: d.status || '–',
                    sanierungsbudget: d.renovation_budget || 0,
                    exit_preis: d.exit_price || 0,
                })
            }
            break
        }
        case 'sanierung': {
            const { data } = await supabase
                .from('renovation_projects')
                .select(`*, property:properties(street, house_number), tasks:renovation_tasks(status)`)
                .eq('portfolio_id', portfolioId)
                .order('created_at', { ascending: false })

            for (const p of data || []) {
                const openTasks = (p.tasks || []).filter((t: any) => t.status !== 'done').length
                rows.push({
                    projekt: p.name || '–',
                    objekt: p.property ? `${p.property.street} ${p.property.house_number}` : '–',
                    budget_soll: p.budget || 0,
                    ist_bezahlt: p.spent || 0,
                    fortschritt: p.budget > 0 ? (p.spent || 0) / p.budget : 0,
                    ziel_enddatum: p.target_date,
                    offene_aufgaben: openTasks,
                })
            }
            break
        }
        default: {
            // Generic: return empty, frontend will handle
            break
        }
    }
    return rows
}

// ── 1mm ≈ 3.78px at 96dpi ──────────────────────────────────────────
const MM_TO_PX = 3.78

// ── Render a single positioned template element ─────────────────────
function renderEl(
    el: any,
    ctx: { title: string; subtitle: string; portfolioName: string; logoUrl: string; today: string; accentColor: string }
): string {
    if (!el.visible) return ''
    const left = el.x * MM_TO_PX
    const top = el.y * MM_TO_PX
    const width = el.w * MM_TO_PX
    const height = (el.h || 5) * MM_TO_PX
    const base = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-family:'Inter',sans-serif;overflow:hidden;`

    switch (el.type) {
        case 'title':
            return `<div style="${base}font-size:${el.fontSize || 16}pt;font-weight:${el.fontWeight || 'bold'};color:${el.color || '#1a1a1a'};text-align:${el.align || 'left'};line-height:1.2">${ctx.title}</div>`
        case 'subtitle':
            return ctx.subtitle ? `<div style="${base}font-size:${el.fontSize || 11}pt;font-weight:${el.fontWeight || 'normal'};color:${el.color || '#555555'};text-align:${el.align || 'left'};line-height:1.2">${ctx.subtitle}</div>` : ''
        case 'portfolio_name':
            return `<div style="${base}font-size:${el.fontSize || 10}pt;font-weight:${el.fontWeight || 'normal'};color:${el.color || '#555555'};text-align:${el.align || 'left'};line-height:1.2">${ctx.portfolioName}</div>`
        case 'date':
            return `<div style="${base}font-size:${el.fontSize || 10}pt;font-weight:${el.fontWeight || 'normal'};color:${el.color || '#888888'};text-align:${el.align || 'left'};line-height:1.2">Stichtag: ${ctx.today}</div>`
        case 'page_number':
            return `<div style="${base}font-size:${el.fontSize || 9}pt;font-weight:${el.fontWeight || 'normal'};color:${el.color || '#888888'};text-align:${el.align || 'right'};line-height:1.2">Seite 1 von 1</div>`
        case 'line':
            return `<div style="${base}border-top:1px solid ${el.color || '#cccccc'}"></div>`
        case 'logo':
            return ctx.logoUrl ? `<img src="${ctx.logoUrl}" style="${base}object-fit:contain" />` : ''
        case 'freetext':
            return `<div style="${base}font-size:${el.fontSize || 10}pt;font-weight:${el.fontWeight || 'normal'};color:${el.color || '#333333'};text-align:${el.align || 'left'};line-height:1.2">${el.text || ''}</div>`
        default:
            return ''
    }
}

// ── HTML/PDF generation ─────────────────────────────────────────────
function generateHtml(
    reportType: string,
    title: string,
    subtitle: string,
    rows: Record<string, any>[],
    columns: string[],
    opts: any,
    template: any,
) {
    const orientation = opts.orientation || 'portrait'
    const pageW = orientation === 'landscape' ? 297 : 210
    const pageH = orientation === 'landscape' ? 210 : 297
    const margin = template?.margin_mm || 15
    const accentColor = template?.accent_color || '#0ea5e9'
    const logoUrl = template?.logo_url || ''
    const headerH = template?.header_height_mm || 50
    const footerH = template?.footer_height_mm || 20
    const today = fmtDate(new Date().toISOString())
    const portfolioName = opts.portfolio_name || 'Portfolio'
    const colDefs = COLUMN_DEFS[reportType] || {}

    // Resolve template elements for this report type + orientation
    const elsByReportOri = template?.elements_by_report_orientation || {}
    const elKey = `${reportType}_${orientation}`
    const tplElements: any[] = elsByReportOri[elKey] || template?.elements || []
    const hasTemplate = tplElements.length > 0

    // Build column headers
    const visibleCols = columns.filter(c => colDefs[c])

    // Sums
    const sumCols = (opts.sums_enabled && opts.sum_columns) ? opts.sum_columns : []
    const sums: Record<string, number> = {}
    for (const sc of sumCols) sums[sc] = 0

    // Build rows HTML
    let rowsHtml = ''
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const bg = i % 2 === 0 ? '#fff' : '#f9fafb'
        let cells = ''
        for (const col of visibleCols) {
            const def = colDefs[col]
            const val = row[col]
            const formatted = def?.format ? fmtValue(val, def.format) : (val ?? '–')
            const align = def?.format === 'currency' || def?.format === 'decimal' || def?.format === 'percent' ? 'right' : 'left'
            cells += `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:${align};font-size:8pt;white-space:nowrap">${formatted}</td>`
            if (sums[col] !== undefined && typeof val === 'number') sums[col] += val
        }
        rowsHtml += `<tr style="background:${bg}">${cells}</tr>`
    }

    // Sum row
    let sumRow = ''
    if (sumCols.length > 0) {
        sumRow = '<tr style="background:#f0f4f8;font-weight:700;border-top:2px solid #d1d5db">'
        for (const col of visibleCols) {
            const def = colDefs[col]
            if (sums[col] !== undefined) {
                const formatted = def?.format ? fmtValue(sums[col], def.format) : sums[col]
                sumRow += `<td style="padding:6px 8px;font-size:8pt;text-align:right">${formatted}</td>`
            } else if (col === visibleCols[0]) {
                sumRow += '<td style="padding:6px 8px;font-size:8pt;font-weight:700">Summe</td>'
            } else {
                sumRow += '<td style="padding:6px 8px"></td>'
            }
        }
        sumRow += '</tr>'
    }

    // Header columns
    let thHtml = ''
    for (const col of visibleCols) {
        const def = colDefs[col]
        const align = def?.format === 'currency' || def?.format === 'decimal' || def?.format === 'percent' ? 'right' : 'left'
        thHtml += `<th style="padding:6px 8px;text-align:${align};font-size:7.5pt;font-weight:600;color:#374151;border-bottom:2px solid ${accentColor};white-space:nowrap">${def?.label || col}</th>`
    }

    const sizeStr = orientation === 'landscape' ? 'A4 landscape' : 'A4'

    // ── Build header/footer from template elements or fallback ───
    const elCtx = { title, subtitle, portfolioName, logoUrl, today, accentColor }
    let headerHtml = ''
    let footerHtml = ''

    if (hasTemplate) {
        const headerEls = tplElements.filter((e: any) => e.zone === 'header' && e.visible)
        const footerEls = tplElements.filter((e: any) => e.zone === 'footer' && e.visible)
        headerHtml = headerEls.map((el: any) => renderEl(el, elCtx)).join('')
        footerHtml = footerEls.map((el: any) => renderEl(el, elCtx)).join('')
    } else {
        headerHtml = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
                <div style="font-size:14pt;font-weight:700;color:#111;margin-bottom:2mm">${title}</div>
                ${subtitle ? `<div style="font-size:9pt;color:#555;margin-bottom:1mm">${subtitle}</div>` : ''}
                <div style="font-size:8pt;color:#888">${portfolioName} · Stichtag: ${today}</div>
            </div>
            ${logoUrl ? `<img src="${logoUrl}" style="max-height:15mm;max-width:45mm;object-fit:contain" />` : ''}
        </div>
        <div style="margin-top:3mm;height:0.5mm;background:${accentColor};opacity:0.3"></div>`
        footerHtml = `
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:7.5pt;color:#888;height:100%">
            <div>Stichtag: ${today}</div>
            <div>Seite 1 von 1</div>
        </div>`
    }

    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
@page { size: ${sizeStr}; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
body { font-family: 'Inter', sans-serif; color: #111; background: #fff }
.page { width: ${pageW}mm; min-height: ${pageH}mm; position: relative; margin: 0 auto; background: #fff; page-break-after: always }
.page:last-child { page-break-after: auto }
.header { position: relative; height: ${headerH}mm;${hasTemplate ? '' : ` padding: ${margin}mm ${margin}mm 0`} }
.footer { position: absolute; bottom: 0; left: 0; right: 0; height: ${footerH}mm;${hasTemplate ? ' border-top: 0.5px solid #e5e7eb' : ` padding: 3mm ${margin}mm`} }
.content { padding: 4mm ${margin}mm 0; }
table { width: 100%; border-collapse: collapse }
thead { display: table-header-group }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact } }
</style>
</head>
<body>
<div class="page">
    <div class="header">
        ${headerHtml}
    </div>
    <div class="content">
        <table>
            <thead><tr>${thHtml}</tr></thead>
            <tbody>${rowsHtml}${sumRow}</tbody>
        </table>
        <div style="margin-top:8mm;font-size:7pt;color:#aaa">${rows.length} Einträge · Erstellt am ${today}</div>
    </div>
    <div class="footer">
        ${footerHtml}
    </div>
</div>
</body>
</html>`
}

// ── MAIN HANDLER ────────────────────────────────────────────────────
serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Authenticate user
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('Missing authorization header')

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

        // Verify user via their JWT
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
            auth: { persistSession: false },
            global: { headers: { Authorization: authHeader } },
        })
        const { data: { user }, error: authError } = await userClient.auth.getUser()
        if (authError || !user) throw new Error('Unauthorized')

        // Service client for data fetching (bypasses RLS for speed, but we scope by portfolio)
        const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { persistSession: false },
        })

        const payload = await req.json()
        const {
            portfolio_id,
            report_type,
            orientation = 'portrait',
            columns = [],
            scope = 'all',
            property_id = null,
            filters = {},
            search = '',
            sort = null,
            sums_enabled = false,
            group_by_property = false,
            dsgvo_anonymize = false,
            extra_options = {},
            filename = 'export.pdf',
            date = new Date().toISOString().split('T')[0],
        } = payload

        if (!portfolio_id || !report_type) throw new Error('Missing portfolio_id or report_type')

        // Verify user owns the portfolio
        const { data: portfolio } = await serviceClient
            .from('portfolios')
            .select('id, name, user_id')
            .eq('id', portfolio_id)
            .single()

        if (!portfolio || portfolio.user_id !== user.id) {
            throw new Error('Portfolio not found or access denied')
        }

        // Load PDF template
        const { data: template } = await serviceClient
            .from('pdf_templates')
            .select('*')
            .eq('portfolio_id', portfolio_id)
            .single()

        // Get subtitle for this report type
        const subtitles = template?.subtitles_by_report_type || {}
        const subtitle = subtitles[report_type] || ''

        // Fetch data
        const rows = await fetchReportData(serviceClient, report_type, portfolio_id, {
            property_id: scope === 'property' ? property_id : null,
            dsgvo_anonymize,
            extra_options,
        })

        // Generate HTML
        const title = REPORT_TITLES[report_type] || 'Report'
        const sumColumns = sums_enabled ? Object.keys(COLUMN_DEFS[report_type] || {}).filter(k => {
            const def = COLUMN_DEFS[report_type]?.[k]
            return def?.format === 'currency'
        }) : []

        const html = generateHtml(report_type, title, subtitle, rows, columns, {
            orientation,
            sums_enabled,
            sum_columns: sumColumns,
            group_by_property,
            portfolio_name: portfolio.name,
        }, template)

        // Store HTML as temporary file in exports bucket
        const exportPath = `${user.id}/${filename.replace('.pdf', '.html')}`

        // Ensure exports bucket exists
        await serviceClient.storage.createBucket('exports', { public: false }).catch(() => { })

        const { error: uploadError } = await serviceClient.storage
            .from('exports')
            .upload(exportPath, new Blob([html], { type: 'text/html' }), {
                upsert: true,
                contentType: 'text/html',
            })

        if (uploadError) throw uploadError

        // Create signed URL (1 hour expiry)
        const { data: signedData, error: signError } = await serviceClient.storage
            .from('exports')
            .createSignedUrl(exportPath, 3600)

        if (signError) throw signError

        return new Response(JSON.stringify({
            url: signedData.signedUrl,
            rows: rows.length,
            filename,
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error: any) {
        console.error('Report PDF error:', error)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
