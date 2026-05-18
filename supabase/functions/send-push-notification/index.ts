import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── FCM HTTP v1 API ─────────────────────────────────────────────
// Uses a service account key stored in Supabase secrets

async function getAccessToken(serviceAccount: any): Promise<string> {
    // Create JWT for Google OAuth2
    const header = { alg: 'RS256', typ: 'JWT' }
    const now = Math.floor(Date.now() / 1000)
    const claim = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    }

    // Base64url encode
    const b64url = (obj: any) => {
        const json = JSON.stringify(obj)
        const b64 = btoa(json)
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }

    const headerB64 = b64url(header)
    const claimB64 = b64url(claim)
    const unsignedJwt = `${headerB64}.${claimB64}`

    // Import RSA private key and sign
    const pemContents = serviceAccount.private_key
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\n/g, '')

    const binaryDer = Uint8Array.from(atob(pemContents), (c: string) => c.charCodeAt(0))

    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        binaryDer.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    )

    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        new TextEncoder().encode(unsignedJwt)
    )

    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    const jwt = `${unsignedJwt}.${sigB64}`

    // Exchange JWT for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    })

    const tokenData = await tokenRes.json()
    return tokenData.access_token
}

async function sendFcmMessage(
    accessToken: string,
    projectId: string,
    fcmToken: string,
    title: string,
    body: string,
    data: Record<string, string> = {}
) {
    const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`

    const message = {
        message: {
            token: fcmToken,
            notification: {
                title,
                body,
            },
            data: {
                ...data,
                click_action: 'FLUTTER_NOTIFICATION_CLICK', // For Capacitor
            },
            android: {
                priority: 'high',
                notification: {
                    icon: 'ic_notification',
                    color: '#4F46E5',
                    channel_id: 'immocontrol_notifications',
                    sound: 'default',
                },
            },
        },
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
    })

    return res.json()
}

// ── MAIN HANDLER ────────────────────────────────────────────────
serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const serviceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT_KEY')
        if (!serviceAccountJson) {
            throw new Error('FCM_SERVICE_ACCOUNT_KEY secret not set')
        }

        const serviceAccount = JSON.parse(serviceAccountJson)
        const projectId = serviceAccount.project_id

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            { auth: { persistSession: false } }
        )

        const payload = await req.json()

        // Payload structure:
        // { event_type: string, title: string, body: string, user_ids: string[], data?: {} }
        // OR called from database webhook:
        // { type: 'INSERT', table: string, record: {}, old_record: {} }

        let title = ''
        let body = ''
        let targetUserIds: string[] = []
        let eventData: Record<string, string> = {}

        // ── Handle database webhook payload ──
        if (payload.type && payload.table && payload.record) {
            const { table, record } = payload

            switch (table) {
                case 'messages': {
                    // Don't notify sender
                    if (record.receiver_id) {
                        targetUserIds = [record.receiver_id]

                        // Look up sender name
                        let senderName = 'Hausverwaltung'
                        // Check if sender is a tenant
                        const { data: senderRole } = await supabaseClient
                            .from('user_roles')
                            .select('role, tenant_id')
                            .eq('user_id', record.sender_id)
                            .limit(1)
                            .single()

                        if (senderRole?.role === 'tenant' && senderRole?.tenant_id) {
                            const { data: tenant } = await supabaseClient
                                .from('tenants')
                                .select('first_name, last_name')
                                .eq('id', senderRole.tenant_id)
                                .single()
                            if (tenant) {
                                senderName = `${tenant.first_name} ${tenant.last_name}`
                            }
                        }

                        // Check if it's a ticket comment
                        if (record.ticket_id) {
                            title = `💬 ${senderName}`
                            body = record.text?.substring(0, 100) || 'Neuer Kommentar zum Ticket'
                            eventData = { route: '/ticket-board', type: 'ticket_comment' }
                        } else {
                            title = senderName
                            body = record.text?.substring(0, 100) || 'Hat Ihnen eine Nachricht gesendet.'
                            eventData = { route: '/investor-messages', type: 'message' }
                        }
                    }
                    break
                }

                case 'tickets': {
                    // Notify the property owner (investor)
                    // Find the owner via tenant -> lease -> unit -> property -> portfolio -> user_id
                    if (record.tenant_id) {
                        const { data: lease } = await supabaseClient
                            .from('leases')
                            .select('unit:units(property:properties(portfolio:portfolios(user_id)))')
                            .eq('tenant_id', record.tenant_id)
                            .eq('status', 'active')
                            .single()

                        const ownerId = (lease as any)?.unit?.property?.portfolio?.user_id
                        if (ownerId) {
                            targetUserIds = [ownerId]
                        }
                    }
                    title = '🎫 Neues Ticket'
                    body = `"${record.title}" wurde erstellt.`
                    eventData = { route: '/ticket-board', type: 'ticket', ticket_id: record.id }
                    break
                }

                case 'announcements': {
                    // Notify all tenants of the property
                    if (record.property_id) {
                        const { data: roles } = await supabaseClient
                            .from('user_roles')
                            .select('user_id')
                            .eq('property_id', record.property_id)
                            .eq('role', 'tenant')

                        targetUserIds = (roles || []).map((r: any) => r.user_id)
                    }
                    title = '📢 Neuer Aushang'
                    body = record.title || 'Ein neuer Aushang wurde erstellt.'
                    eventData = { route: '/tenant/announcements', type: 'announcement' }
                    break
                }

                case 'documents': {
                    // Notify tenants if document is for a specific unit/property
                    if (record.unit_id) {
                        const { data: leases } = await supabaseClient
                            .from('leases')
                            .select('tenant:tenants(id), unit:units(property:properties(portfolio:portfolios(user_id)))')
                            .eq('unit_id', record.unit_id)
                            .eq('status', 'active')

                        // Find tenant user_ids
                        for (const lease of leases || []) {
                            const { data: roles } = await supabaseClient
                                .from('user_roles')
                                .select('user_id')
                                .eq('tenant_id', (lease as any).tenant?.id)
                                .eq('role', 'tenant')

                            targetUserIds.push(...(roles || []).map((r: any) => r.user_id))
                        }
                    }
                    title = '📄 Neues Dokument'
                    body = record.name || 'Ein neues Dokument wurde hochgeladen.'
                    eventData = { route: '/tenant/documents', type: 'document' }
                    break
                }

                case 'user_roles': {
                    // Tenant just registered - notify the investor/owner
                    if (record.role === 'tenant' && record.property_id) {
                        const { data: prop } = await supabaseClient
                            .from('properties')
                            .select('portfolio:portfolios(user_id)')
                            .eq('id', record.property_id)
                            .single()

                        const ownerId = (prop as any)?.portfolio?.user_id
                        if (ownerId) {
                            targetUserIds = [ownerId]
                        }

                        // Get tenant name
                        if (record.tenant_id) {
                            const { data: tenant } = await supabaseClient
                                .from('tenants')
                                .select('first_name, last_name')
                                .eq('id', record.tenant_id)
                                .single()

                            body = tenant
                                ? `${tenant.first_name} ${tenant.last_name} hat sich erfolgreich registriert.`
                                : 'Ein Mieter hat sich erfolgreich registriert.'
                        }
                    }
                    title = '✅ Mieter registriert'
                    if (!body) body = 'Ein Mieter hat sich erfolgreich im Portal registriert.'
                    eventData = { route: '/tenant-management', type: 'registration' }
                    break
                }

                default:
                    return new Response(JSON.stringify({ skipped: true, reason: `Unknown table: ${table}` }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                        status: 200,
                    })
            }
        }
        // ── Handle direct API call ──
        else if (payload.event_type) {
            title = payload.title || 'ImmoControl Pro 360'
            body = payload.body || ''
            targetUserIds = payload.user_ids || []
            eventData = payload.data || {}
        }

        if (targetUserIds.length === 0 || !title) {
            return new Response(JSON.stringify({ sent: 0, reason: 'No targets or no title' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            })
        }

        // ── Get FCM tokens for target users ──
        const { data: subscriptions } = await supabaseClient
            .from('push_subscriptions')
            .select('fcm_token')
            .in('user_id', targetUserIds)

        if (!subscriptions || subscriptions.length === 0) {
            return new Response(JSON.stringify({ sent: 0, reason: 'No FCM tokens found' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            })
        }

        // ── Get access token ──
        const accessToken = await getAccessToken(serviceAccount)

        // ── Send to all tokens ──
        const results = []
        for (const sub of subscriptions) {
            try {
                const result = await sendFcmMessage(
                    accessToken,
                    projectId,
                    sub.fcm_token,
                    title,
                    body,
                    eventData
                )
                results.push({ token: sub.fcm_token.substring(0, 10) + '...', result })
            } catch (err: any) {
                results.push({ token: sub.fcm_token.substring(0, 10) + '...', error: err.message })
            }
        }

        return new Response(JSON.stringify({ sent: results.length, results }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error: any) {
        console.error('Push notification error:', error)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
