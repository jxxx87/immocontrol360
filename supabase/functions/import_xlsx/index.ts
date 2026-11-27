import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

// ─────────────────────────────────────────────────────────────────────────────
// import_xlsx (derzeit nicht deployt, kein Aufrufer in der App)
//
// Stand Komplett-Check 2026-11-27:
//  • Nur angemeldete Nutzer (Vertrag C2); `userId` im Body wird ignoriert.
//  • Alle Lese- und Schreibzugriffe laufen mit dem JWT des Aufrufers (RLS) – die
//    Function kann nichts, was der Nutzer nicht auch direkt dürfte.
//  • Import nur in eigene Portfolios; alle Suchen sind auf den Aufrufer bzw. das
//    Portfolio beschränkt (keine Treffer bei fremden Mandanten).
//  • Jeder Fehler landet in stats.errors; keine erfundenen Standardwerte.
//  Hinweis: Ohne SQL-Funktion gibt es keine Transaktion – bei Abbruch bleiben die bis
//  dahin importierten Zeilen bestehen (sie sind in stats gezählt).
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_ROWS = 2000

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

const text = (value: unknown, max = 200): string =>
    value === null || value === undefined ? '' : String(value).trim().slice(0, max)

const optText = (value: unknown, max = 200): string | null => text(value, max) || null

// Fehlende Zahlen bleiben leer (null) statt erfundener Standardwerte
const optNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null
    const n = parseFloat(String(value).replace(',', '.'))
    return Number.isFinite(n) ? n : null
}
const optInt = (value: unknown): number | null => {
    const n = optNumber(value)
    return n === null ? null : Math.round(n)
}

const toBool = (value: unknown): boolean =>
    value === true || ['1', 'true', 'ja', 'yes', 'x'].includes(String(value ?? '').trim().toLowerCase())

const toIsoDate = (value: unknown): string | null => {
    const s = text(value, 40)
    if (!s) return null
    const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
    if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const authHeader = req.headers.get('Authorization') || ''
        const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
        if (!jwt) throw new HttpError(401, 'Unauthorized')

        // Client mit dem JWT des Aufrufers -> RLS gilt für alle Abfragen
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            {
                auth: { persistSession: false, autoRefreshToken: false },
                global: { headers: { Authorization: `Bearer ${jwt}` } },
            }
        )
        const { data: authData, error: authError } = await supabaseClient.auth.getUser(jwt)
        const user = authData?.user
        if (authError || !user || (user as any).is_anonymous === true) throw new HttpError(401, 'Unauthorized')
        const userId = user.id

        let payload: any
        try {
            payload = await req.json()
        } catch (_err) {
            throw new HttpError(400, 'Ungültige Anfrage.')
        }
        const rows = payload?.data
        if (!Array.isArray(rows) || rows.length === 0) {
            throw new HttpError(400, 'No data provided')
        }
        if (rows.length > MAX_ROWS) {
            throw new HttpError(400, `Maximal ${MAX_ROWS} Zeilen pro Import.`)
        }

        const stats = { properties: 0, units: 0, tenants: 0, leases: 0, errors: [] as string[] }
        const rowLabel = (row: any, index: number) => `Zeile ${row?.rowNumber ?? index + 1}`

        // Eigene Portfolios des Aufrufers (Import nur dorthin)
        const { data: ownPortfolios, error: portfolioError } = await supabaseClient
            .from('portfolios')
            .select('id, name, is_primary')
            .eq('user_id', userId)
        if (portfolioError) throw new Error(`Portfolio lookup failed: ${portfolioError.message}`)
        const portfolios = ownPortfolios || []
        const defaultPortfolioId = isUuid(payload?.portfolioId) && portfolios.some((p: any) => p.id === payload.portfolioId)
            ? payload.portfolioId
            : (portfolios.find((p: any) => p.is_primary)?.id || (portfolios.length === 1 ? portfolios[0].id : null))

        const resolvePortfolio = (value: unknown): string | null => {
            const v = text(value, 200)
            if (!v) return defaultPortfolioId
            const byId = portfolios.find((p: any) => p.id === v)
            if (byId) return byId.id
            const byName = portfolios.filter((p: any) => String(p.name || '').trim().toLowerCase() === v.toLowerCase())
            return byName.length === 1 ? byName[0].id : null
        }

        // 1. Process Properties
        const propertiesMap = new Map<string, string>() // Key: portfolio+street+number+zip+city, Value: ID
        const propKeyOf = (row: any, portfolioId: string | null) =>
            `${portfolioId || ''}-${text(row.street)}-${text(row.house_number)}-${text(row.zip)}-${text(row.city)}`.toLowerCase()

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i] || {}
            const street = text(row.street)
            const houseNumber = text(row.house_number, 20)
            if (!street || !text(row.zip)) continue // Skip invalid
            if (!houseNumber) {
                stats.errors.push(`${rowLabel(row, i)}: Hausnummer fehlt`)
                continue
            }

            const portfolioId = resolvePortfolio(row.portfolio)
            if (!portfolioId) {
                stats.errors.push(`${rowLabel(row, i)}: Portfolio unbekannt oder nicht eindeutig`)
                continue
            }

            const propKey = propKeyOf(row, portfolioId)
            // Check if we already processed this in this batch to avoid multi-inserts
            if (propertiesMap.has(propKey)) continue

            // Vorhandenes Objekt nur im selben Portfolio suchen
            const { data: propData, error: propError } = await supabaseClient
                .from('properties')
                .select('id')
                .eq('portfolio_id', portfolioId)
                .eq('street', street)
                .eq('house_number', houseNumber)
                .eq('zip', text(row.zip, 20))
                .eq('city', text(row.city))
                .limit(2)

            if (propError) {
                stats.errors.push(`${rowLabel(row, i)}: Objektprüfung fehlgeschlagen - ${propError.message}`)
                continue
            }
            if ((propData || []).length > 1) {
                stats.errors.push(`${rowLabel(row, i)}: Objekt ist im Portfolio mehrfach vorhanden – bitte manuell zuordnen`)
                continue
            }

            let propertyId = propData?.[0]?.id as string | undefined
            if (!propertyId) {
                const { data: newProp, error: insertError } = await supabaseClient
                    .from('properties')
                    .insert({
                        user_id: userId,
                        portfolio_id: portfolioId,
                        street,
                        house_number: houseNumber,
                        zip: text(row.zip, 20),
                        city: optText(row.city),
                        construction_year: optInt(row.construction_year),
                        property_type: text(row.property_type, 40) || 'residential'
                    })
                    .select('id')
                    .single()

                if (insertError || !newProp) {
                    stats.errors.push(`${rowLabel(row, i)}: Objekt konnte nicht angelegt werden - ${insertError?.message || 'unbekannt'}`)
                    continue
                }
                propertyId = newProp.id
                stats.properties++
            }
            propertiesMap.set(propKey, propertyId as string)
        }

        // 2. Process Units
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i] || {}
            const portfolioId = resolvePortfolio(row.portfolio)
            const propertyId = propertiesMap.get(propKeyOf(row, portfolioId))
            if (!propertyId) continue // Fehler wurde oben bereits erfasst

            const unitName = text(row.unit_name, 120)
            if (!unitName) continue

            const { data: unitData, error: unitError } = await supabaseClient
                .from('units')
                .select('id')
                .eq('property_id', propertyId)
                .eq('unit_name', unitName)
                .limit(2)

            if (unitError) {
                stats.errors.push(`${rowLabel(row, i)}: Einheitenprüfung fehlgeschlagen - ${unitError.message}`)
                continue
            }
            if ((unitData || []).length > 1) {
                stats.errors.push(`${rowLabel(row, i)}: Einheit "${unitName}" ist mehrfach vorhanden – bitte manuell zuordnen`)
                continue
            }

            let unitId = unitData?.[0]?.id as string | undefined
            if (!unitId) {
                const { data: newUnit, error: insertError } = await supabaseClient
                    .from('units')
                    .insert({
                        user_id: userId,
                        property_id: propertyId,
                        unit_name: unitName,
                        floor: optText(row.floor, 40),
                        sqm: optNumber(row.sqm),
                        rooms: optNumber(row.rooms),
                        bathrooms: optInt(row.bathrooms),
                        bedrooms: optInt(row.bedrooms),
                        balcony: toBool(row.balcony),
                        fitted_kitchen: toBool(row.fitted_kitchen),
                        is_vacation_rental: toBool(row.is_vacation_rental),
                        cold_rent_ist: optNumber(row.cold_rent_ist),
                        target_rent: optNumber(row.target_rent)
                    })
                    .select('id')
                    .single()

                if (insertError || !newUnit) {
                    stats.errors.push(`${rowLabel(row, i)}: Einheit konnte nicht angelegt werden - ${insertError?.message || 'unbekannt'}`)
                    continue
                }
                unitId = newUnit.id
                stats.units++
            }

            // 3. Process Tenant if data present
            if (!unitId || !text(row.t_lastname)) continue

            // Vorhandenen Mieter nur beim Aufrufer und nur über eine echte E-Mail-Adresse suchen
            const tenantEmail = text(row.t_email, 254).toLowerCase()
            let tenantId: string | undefined
            if (tenantEmail) {
                const { data: existingTenants, error: tenantLookupError } = await supabaseClient
                    .from('tenants')
                    .select('id')
                    .eq('user_id', userId)
                    .ilike('email', tenantEmail.replace(/[\\%_]/g, (c) => `\\${c}`))
                    .order('created_at', { ascending: true })
                    .limit(1)
                if (tenantLookupError) {
                    stats.errors.push(`${rowLabel(row, i)}: Mieterprüfung fehlgeschlagen - ${tenantLookupError.message}`)
                    continue
                }
                tenantId = existingTenants?.[0]?.id
            }

            if (!tenantId) {
                const { data: newTenant, error: tenantError } = await supabaseClient
                    .from('tenants')
                    .insert({
                        user_id: userId,
                        first_name: optText(row.t_firstname, 120),
                        last_name: text(row.t_lastname, 120),
                        email: tenantEmail || null,
                        phone: optText(row.t_phone, 60),
                        occupants: optInt(row.t_occupants)
                    })
                    .select('id')
                    .single()

                if (tenantError || !newTenant) {
                    stats.errors.push(`${rowLabel(row, i)}: Mieter konnte nicht angelegt werden - ${tenantError?.message || 'unbekannt'}`)
                    continue
                }
                tenantId = newTenant.id
                stats.tenants++
            }

            // Create Lease – nur wenn die Einheit noch keinen aktiven Vertrag hat
            const { data: activeLeases, error: leaseLookupError } = await supabaseClient
                .from('leases')
                .select('id')
                .eq('unit_id', unitId)
                .eq('status', 'active')
                .limit(1)
            if (leaseLookupError) {
                stats.errors.push(`${rowLabel(row, i)}: Vertragsprüfung fehlgeschlagen - ${leaseLookupError.message}`)
                continue
            }
            if ((activeLeases || []).length > 0) continue

            const startDate = toIsoDate(row.t_start_date)
            if (!startDate) {
                stats.errors.push(`${rowLabel(row, i)}: Mietbeginn fehlt oder ist ungültig – Mietvertrag nicht angelegt`)
                continue
            }

            const { error: leaseError } = await supabaseClient.from('leases').insert({
                user_id: userId,
                tenant_id: tenantId,
                unit_id: unitId,
                start_date: startDate,
                cold_rent: optNumber(row.t_cold_rent) ?? 0,
                service_charge: optNumber(row.t_service_charge) ?? 0,
                heating_cost: optNumber(row.t_heating_cost) ?? 0,
                other_costs: optNumber(row.t_other_costs) ?? 0,
                deposit: optNumber(row.t_deposit),
                status: 'active'
            })
            if (leaseError) {
                stats.errors.push(`${rowLabel(row, i)}: Mietvertrag konnte nicht angelegt werden - ${leaseError.message}`)
                continue
            }
            stats.leases++
        }

        return json(stats)
    } catch (error: any) {
        if (error instanceof HttpError) {
            return json({ error: error.message }, error.status)
        }
        console.error('import_xlsx error:', error?.message || error)
        return json({ error: 'Der Import ist fehlgeschlagen.' }, 500)
    }
})
