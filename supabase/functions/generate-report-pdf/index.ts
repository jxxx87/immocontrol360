import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

// ─────────────────────────────────────────────────────────────────────────────
// generate-report-pdf (derzeit nicht deployt, kein Aufrufer in der App – die App
// erzeugt Reports clientseitig über src/lib/pdfGenerator.js).
//
// Stand Komplett-Check 2026-11-27:
//  • Nur angemeldete Nutzer (Vertrag C2); alle Datenabfragen laufen mit dem JWT des
//    Aufrufers (RLS) – es werden nur Daten gelesen, die der Nutzer selbst sehen darf.
//  • Abfragen passen zum Live-Schema; jeder Abfragefehler bricht ab (keine leeren Reports).
//  • Nicht implementierte Report-Typen liefern einen klaren Fehler statt eines leeren Reports.
//  • Alle Werte werden HTML-escaped, Farben/URLs validiert, der Speicherpfad wird
//    serverseitig erzeugt (kein Pfad aus dem Request).
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

class HttpError extends Error {
    status: number
    constructor(status: number, message: string) {
        super(message)
        this.status = status
    }
}

const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status,
    })

const isUuid = (value: unknown): value is string =>
    typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

// ── Escaping / Validierung ──────────────────────────────────────────
const escapeHtml = (value: unknown): string =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c] as string))

const safeColor = (value: unknown, fallback: string): string =>
    typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : fallback

const safeAlign = (value: unknown, fallback: string): string =>
    value === 'left' || value === 'center' || value === 'right' ? value : fallback

const safeWeight = (value: unknown, fallback: string): string =>
    typeof value === 'string' && /^(normal|bold|[1-9]00)$/.test(value) ? value : fallback

const safeNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
}

// Logo nur als https-URL oder eingebettetes Rasterbild
const safeImageUrl = (value: unknown): string => {
    if (typeof value !== 'string') return ''
    const v = value.trim()
    if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v
    if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(v)) return v
    return ''
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

// Serverseitig umgesetzte Report-Typen (die übrigen erzeugt die App clientseitig)
const SUPPORTED_REPORTS = new Set(['immobilien', 'bankaufstellung', 'mietverhaeltnisse', 'deals', 'sanierung'])

// ── Darlehens-Helfer (wie Properties.jsx) ───────────────────────────
const calculateMonthlyPayment = (loan: any) => {
    if (loan.fixed_annuity) return parseFloat(loan.fixed_annuity)
    const originalAmount = parseFloat(loan.loan_amount || 0)
    const interestRate = parseFloat(loan.interest_rate || 0) / 100
    const repaymentRate = parseFloat(loan.initial_repayment_rate || 0) / 100
    return (originalAmount * (interestRate + repaymentRate)) / 12
}

const calculateCurrentDebt = (loan: any) => {
    const originalAmount = parseFloat(loan.loan_amount || 0)
    const interestRate = parseFloat(loan.interest_rate || 0) / 100
    const monthlyPayment = calculateMonthlyPayment(loan)

    const hasActual = loan.actual_residual_debt !== null && loan.actual_residual_debt !== undefined
    const amount = hasActual ? parseFloat(loan.actual_residual_debt) : originalAmount
    const startDateStr = hasActual && loan.actual_residual_debt_date ? loan.actual_residual_debt_date : loan.start_date
    if (!startDateStr) return amount

    const today = new Date()
    let balance = amount
    const currentDate = new Date(startDateStr)
    let months = 0
    while (balance > 0.01 && months < 600) {
        if (currentDate > today) break
        const monthlyInterest = balance * interestRate / 12
        const principal = monthlyPayment - monthlyInterest
        const endBalance = balance - principal
        balance = endBalance < 0 ? 0 : endBalance
        currentDate.setMonth(currentDate.getMonth() + 1)
        months++
    }
    return balance
}

const must = (res: { data: any; error: any }, label: string) => {
    if (res.error) throw new Error(`${label} query failed: ${res.error.message}`)
    return res.data || []
}

// ── Data fetching per report type (Client mit Nutzer-JWT -> RLS) ────
async function fetchReportData(
    db: any,
    reportType: string,
    portfolioId: string,
    opts: any
) {
    const rows: Record<string, any>[] = []

    switch (reportType) {
        case 'immobilien':
        case 'bankaufstellung': {
            let q = db
                .from('properties')
                .select('id, street, house_number, total_investment_cost, market_value_total, units(id, sqm, leases(cold_rent, status)), loans(loan_amount, interest_rate, initial_repayment_rate, fixed_annuity, actual_residual_debt, actual_residual_debt_date, start_date)')
                .eq('portfolio_id', portfolioId)
                .order('street')

            if (opts.property_id) q = q.eq('id', opts.property_id)

            const data = must(await q, 'properties')
            for (const p of data) {
                const units = p.units || []
                const totalUnits = units.length
                const sqm = units.reduce((s: number, u: any) => s + (Number(u.sqm) || 0), 0)
                const rent = units.reduce((s: number, u: any) => {
                    const a = u.leases?.find((l: any) => l.status === 'active')
                    return s + (Number(a?.cold_rent) || 0)
                }, 0)
                const loans = p.loans || []
                const restschuld = loans.reduce((s: number, l: any) => s + calculateCurrentDebt(l), 0)
                const rate = loans.reduce((s: number, l: any) => s + calculateMonthlyPayment(l), 0)
                const kaufpreis = Number(p.total_investment_cost) || 0
                const marktpreis = Number(p.market_value_total) || 0
                const vacant = units.filter((u: any) => !u.leases?.some((l: any) => l.status === 'active')).length
                const adresse = `${p.street || ''} ${p.house_number || ''}`.trim()

                rows.push({
                    adresse,
                    objekt: adresse,
                    einheiten: totalUnits,
                    kaufpreis, marktpreis, restschuld,
                    miete_monat: rent,
                    cashflow_monat: rent - rate,
                    wohnflaeche: sqm,
                    leerstand: `${vacant}/${totalUnits}`,
                    ltv: marktpreis > 0 ? restschuld / marktpreis : 0,
                    dscr: rate > 0 ? rent / rate : 0,
                    _property_id: p.id,
                    _property_label: adresse,
                })
            }
            break
        }
        case 'mietverhaeltnisse': {
            // Erst die Einheiten des Portfolios ermitteln, dann nur deren Mietverträge laden
            let pq = db
                .from('properties')
                .select('id, street, house_number, units(id, unit_name, sqm)')
                .eq('portfolio_id', portfolioId)
            if (opts.property_id) pq = pq.eq('id', opts.property_id)
            const props = must(await pq, 'properties')

            const unitMap = new Map<string, { unit: any; property: any }>()
            for (const p of props) {
                for (const u of p.units || []) unitMap.set(u.id, { unit: u, property: p })
            }
            const unitIds = [...unitMap.keys()]
            if (unitIds.length === 0) break

            const leases = must(await db
                .from('leases')
                .select('id, unit_id, cold_rent, service_charge, heating_cost, start_date, deposit, status, tenant:tenants(first_name, last_name)')
                .in('unit_id', unitIds)
                .order('start_date', { ascending: false }), 'leases')

            let idx = 0
            for (const l of leases) {
                const ref = unitMap.get(l.unit_id)
                if (!ref) continue
                const t = l.tenant
                idx++
                const name = opts.dsgvo_anonymize ? `Mieter ${idx}` : `${t?.first_name || ''} ${t?.last_name || ''}`.trim()
                const propLabel = `${ref.property.street || ''} ${ref.property.house_number || ''}`.trim()
                rows.push({
                    mietername: name || '–',
                    immobilie_einheit: `${propLabel} / ${ref.unit.unit_name || ''}`,
                    kaltmiete: Number(l.cold_rent) || 0,
                    nebenkosten: (Number(l.service_charge) || 0) + (Number(l.heating_cost) || 0),
                    warmmiete: (Number(l.cold_rent) || 0) + (Number(l.service_charge) || 0) + (Number(l.heating_cost) || 0),
                    mietbeginn: l.start_date,
                    wohnflaeche: Number(ref.unit.sqm) || 0,
                    kaution: l.deposit === null || l.deposit === undefined ? null : Number(l.deposit),
                    status: l.status === 'active' ? 'Aktiv' : l.status,
                    zahlstatus: '–',
                    _property_id: ref.property.id,
                    _property_label: propLabel,
                })
            }
            break
        }
        case 'deals': {
            const data = must(await db
                .from('deals')
                .select('id, name, purchase_price, equity, created_at')
                .eq('portfolio_id', portfolioId)
                .order('created_at', { ascending: false }), 'deals')

            // Nur vorhandene Spalten; nicht gespeicherte Kennzahlen bleiben leer ('–')
            for (const d of data) {
                rows.push({
                    dealname: d.name || '–',
                    kaufpreis: Number(d.purchase_price) || 0,
                    ek: Number(d.equity) || 0,
                    rendite: null,
                    cashflow: null,
                    dscr: null,
                    status: null,
                    sanierungsbudget: null,
                    exit_preis: null,
                })
            }
            break
        }
        case 'sanierung': {
            let pq = db
                .from('properties')
                .select('id, street, house_number')
                .eq('portfolio_id', portfolioId)
            if (opts.property_id) pq = pq.eq('id', opts.property_id)
            const props = must(await pq, 'properties')
            const propMap = new Map<string, any>(props.map((p: any) => [p.id, p]))
            if (propMap.size === 0) break

            const projects = must(await db
                .from('renovation_projects')
                .select('id, name, status, target_end_date, property_id, tasks:renovation_tasks(is_completed)')
                .in('property_id', [...propMap.keys()])
                .order('created_at', { ascending: false }), 'renovation_projects')

            for (const p of projects) {
                const prop = propMap.get(p.property_id)
                const openTasks = (p.tasks || []).filter((t: any) => !t.is_completed).length
                rows.push({
                    projekt: p.name || '–',
                    objekt: prop ? `${prop.street || ''} ${prop.house_number || ''}`.trim() : '–',
                    // Budget/Ist-Kosten werden in renovation_projects nicht gespeichert
                    budget_soll: null,
                    ist_bezahlt: null,
                    fortschritt: null,
                    ziel_enddatum: p.target_end_date,
                    offene_aufgaben: openTasks,
                })
            }
            break
        }
        default:
            throw new HttpError(400, `Der Report-Typ "${reportType}" wird serverseitig nicht unterstützt.`)
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
    if (!el || !el.visible) return ''
    const left = safeNumber(el.x, 0, 0, 400) * MM_TO_PX
    const top = safeNumber(el.y, 0, 0, 400) * MM_TO_PX
    const width = safeNumber(el.w, 10, 0, 400) * MM_TO_PX
    const height = safeNumber(el.h, 5, 0, 400) * MM_TO_PX
    const base = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-family:'Inter',sans-serif;overflow:hidden;`
    const text = (defSize: number, defWeight: string, defColor: string, defAlign: string) =>
        `font-size:${safeNumber(el.fontSize, defSize, 4, 72)}pt;font-weight:${safeWeight(el.fontWeight, defWeight)};color:${safeColor(el.color, defColor)};text-align:${safeAlign(el.align, defAlign)};line-height:1.2`

    switch (el.type) {
        case 'title':
            return `<div style="${base}${text(16, 'bold', '#1a1a1a', 'left')}">${escapeHtml(ctx.title)}</div>`
        case 'subtitle':
            return ctx.subtitle ? `<div style="${base}${text(11, 'normal', '#555555', 'left')}">${escapeHtml(ctx.subtitle)}</div>` : ''
        case 'portfolio_name':
            return `<div style="${base}${text(10, 'normal', '#555555', 'left')}">${escapeHtml(ctx.portfolioName)}</div>`
        case 'date':
            return `<div style="${base}${text(10, 'normal', '#888888', 'left')}">Stichtag: ${escapeHtml(ctx.today)}</div>`
        case 'page_number':
            return `<div style="${base}${text(9, 'normal', '#888888', 'right')}">Seite 1 von 1</div>`
        case 'line':
            return `<div style="${base}border-top:1px solid ${safeColor(el.color, '#cccccc')}"></div>`
        case 'logo':
            return ctx.logoUrl ? `<img src="${escapeHtml(ctx.logoUrl)}" style="${base}object-fit:contain" />` : ''
        case 'freetext':
            return `<div style="${base}${text(10, 'normal', '#333333', 'left')}">${escapeHtml(el.text || '')}</div>`
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
    const orientation = opts.orientation === 'landscape' ? 'landscape' : 'portrait'
    const pageW = orientation === 'landscape' ? 297 : 210
    const pageH = orientation === 'landscape' ? 210 : 297
    const margin = safeNumber(template?.margin_mm, 15, 0, 60)
    const accentColor = safeColor(template?.accent_color, '#0ea5e9')
    const logoUrl = safeImageUrl(template?.logo_url)
    const headerH = safeNumber(template?.header_height_mm, 50, 0, 150)
    const footerH = safeNumber(template?.footer_height_mm, 20, 0, 100)
    const today = fmtDate(new Date().toISOString())
    const portfolioName = opts.portfolio_name || 'Portfolio'
    const colDefs = COLUMN_DEFS[reportType] || {}

    // Resolve template elements for this report type + orientation
    const elsByReportOri = template?.elements_by_report_orientation || {}
    const elKey = `${reportType}_${orientation}`
    const rawElements = elsByReportOri[elKey] || template?.elements || []
    const tplElements: any[] = Array.isArray(rawElements) ? rawElements : []
    const hasTemplate = tplElements.length > 0

    // Build column headers
    const requested = Array.isArray(columns) ? columns.filter(c => typeof c === 'string') : []
    const visibleCols = (requested.length > 0 ? requested : Object.keys(colDefs)).filter(c => colDefs[c])

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
            cells += `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:${align};font-size:8pt;white-space:nowrap">${escapeHtml(formatted)}</td>`
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
                sumRow += `<td style="padding:6px 8px;font-size:8pt;text-align:right">${escapeHtml(formatted)}</td>`
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
        thHtml += `<th style="padding:6px 8px;text-align:${align};font-size:7.5pt;font-weight:600;color:#374151;border-bottom:2px solid ${accentColor};white-space:nowrap">${escapeHtml(def?.label || col)}</th>`
    }

    const sizeStr = orientation === 'landscape' ? 'A4 landscape' : 'A4'

    // ── Build header/footer from template elements or fallback ───
    const elCtx = { title, subtitle, portfolioName, logoUrl, today, accentColor }
    let headerHtml = ''
    let footerHtml = ''

    if (hasTemplate) {
        const headerEls = tplElements.filter((e: any) => e?.zone === 'header' && e.visible)
        const footerEls = tplElements.filter((e: any) => e?.zone === 'footer' && e.visible)
        headerHtml = headerEls.map((el: any) => renderEl(el, elCtx)).join('')
        footerHtml = footerEls.map((el: any) => renderEl(el, elCtx)).join('')
    } else {
        headerHtml = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
                <div style="font-size:14pt;font-weight:700;color:#111;margin-bottom:2mm">${escapeHtml(title)}</div>
                ${subtitle ? `<div style="font-size:9pt;color:#555;margin-bottom:1mm">${escapeHtml(subtitle)}</div>` : ''}
                <div style="font-size:8pt;color:#888">${escapeHtml(portfolioName)} · Stichtag: ${escapeHtml(today)}</div>
            </div>
            ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" style="max-height:15mm;max-width:45mm;object-fit:contain" />` : ''}
        </div>
        <div style="margin-top:3mm;height:0.5mm;background:${accentColor};opacity:0.3"></div>`
        footerHtml = `
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:7.5pt;color:#888;height:100%">
            <div>Stichtag: ${escapeHtml(today)}</div>
            <div>Seite 1 von 1</div>
        </div>`
    }

    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
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
        <div style="margin-top:8mm;font-size:7pt;color:#aaa">${rows.length} Einträge · Erstellt am ${escapeHtml(today)}</div>
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
        // Authenticate user (anon-Key zählt nicht als Anmeldung)
        const authHeader = req.headers.get('Authorization') || ''
        const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
        if (!jwt) throw new HttpError(401, 'Unauthorized')

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

        // Client mit dem JWT des Nutzers: alle Datenabfragen unterliegen RLS
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${jwt}` } },
        })
        const { data: authData, error: authError } = await userClient.auth.getUser(jwt)
        const user = authData?.user
        if (authError || !user || (user as any).is_anonymous === true) throw new HttpError(401, 'Unauthorized')

        // Service client nur für den Export-Speicher (Pfad serverseitig erzeugt)
        const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        })

        let payload: any
        try {
            payload = await req.json()
        } catch (_err) {
            throw new HttpError(400, 'Ungültige Anfrage.')
        }
        const {
            portfolio_id,
            report_type,
            orientation = 'portrait',
            columns = [],
            scope = 'all',
            property_id = null,
            sums_enabled = false,
            group_by_property = false,
            dsgvo_anonymize = false,
            extra_options = {},
            filename = 'export.pdf',
        } = payload || {}

        if (!isUuid(portfolio_id) || typeof report_type !== 'string') {
            throw new HttpError(400, 'portfolio_id oder report_type fehlt.')
        }
        if (!SUPPORTED_REPORTS.has(report_type)) {
            throw new HttpError(400, `Der Report-Typ "${report_type}" wird serverseitig nicht unterstützt.`)
        }
        if (scope === 'property' && !isUuid(property_id)) {
            throw new HttpError(400, 'property_id fehlt.')
        }

        // Zugriff auf das Portfolio über RLS (Eigentümer oder freigegeben)
        const { data: portfolio, error: portfolioError } = await userClient
            .from('portfolios')
            .select('id, name')
            .eq('id', portfolio_id)
            .maybeSingle()
        if (portfolioError) throw new Error(`portfolio query failed: ${portfolioError.message}`)
        if (!portfolio) throw new HttpError(403, 'Portfolio nicht gefunden oder kein Zugriff.')

        // Load PDF template
        const { data: template, error: templateError } = await userClient
            .from('pdf_templates')
            .select('*')
            .eq('portfolio_id', portfolio_id)
            .limit(1)
            .maybeSingle()
        if (templateError) throw new Error(`pdf_templates query failed: ${templateError.message}`)

        // Get subtitle for this report type
        const subtitles = template?.subtitles_by_report_type || {}
        const subtitle = typeof subtitles[report_type] === 'string' ? subtitles[report_type] : ''

        // Fetch data
        const rows = await fetchReportData(userClient, report_type, portfolio_id, {
            property_id: scope === 'property' ? property_id : null,
            dsgvo_anonymize: !!dsgvo_anonymize,
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

        // Dateiname nur als Anzeige-Name; Speicherpfad serverseitig (kein Pfad-Traversal)
        const baseName = String(filename || 'export')
            .replace(/\.(pdf|html?)$/i, '')
            .replace(/[^A-Za-z0-9._-]+/g, '_')
            .replace(/^[._]+/, '')
            .slice(0, 80) || 'export'
        const exportPath = `${user.id}/${crypto.randomUUID()}_${baseName}.html`

        // Ensure exports bucket exists
        await serviceClient.storage.createBucket('exports', { public: false }).catch(() => { })

        const { error: uploadError } = await serviceClient.storage
            .from('exports')
            .upload(exportPath, new Blob([html], { type: 'text/html' }), {
                upsert: false,
                contentType: 'text/html',
            })

        if (uploadError) throw new Error(`upload failed: ${uploadError.message}`)

        // Create signed URL (1 hour expiry)
        const { data: signedData, error: signError } = await serviceClient.storage
            .from('exports')
            .createSignedUrl(exportPath, 3600)

        if (signError) throw new Error(`signing failed: ${signError.message}`)

        return json({
            url: signedData.signedUrl,
            rows: rows.length,
            filename: `${baseName}.pdf`,
        })

    } catch (error: any) {
        if (error instanceof HttpError) {
            return json({ error: error.message }, error.status)
        }
        console.error('Report PDF error:', error?.message || error)
        return json({ error: 'Der Report konnte nicht erstellt werden.' }, 500)
    }
})
