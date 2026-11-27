import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

// ─────────────────────────────────────────────────────────────────────────────
// send-push-notification
//
// Nur interne Aufrufe (Komplett-Check 2026-11-27):
//  • Der DB-Trigger notify_push ruft die Function mit "Authorization: Bearer
//    <service_role-Schlüssel>" auf -> dieser Weg bleibt unverändert erhalten.
//  • Optional: Secret PUSH_WEBHOOK_SECRET (Header x-webhook-secret oder Bearer),
//    z. B. wenn notify_push später auf ein Vault-Secret umgestellt wird.
//  • Alle anderen Aufrufer (auch der öffentliche anon-Key) erhalten 401.
// Webhook-Datensätze werden nicht blind übernommen, sondern per ID frisch aus der
// Datenbank geladen (nur kürzlich angelegte Zeilen) – gefälschte Inhalte im Body
// werden so nie als Push verschickt.
// Optional: PUSH_HIDE_CONTENT=true sendet nur neutrale Texte (keine Nachrichten-
// inhalte/Namen an Google FCM).
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

const EVENT_MAX_AGE_MS = 15 * 60 * 1000
const MAX_DIRECT_TARGETS = 500
const HIDE_CONTENT = (Deno.env.get('PUSH_HIDE_CONTENT') || '').toLowerCase() === 'true'

const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status,
    })

const isUuid = (value: unknown): value is string =>
    typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

const oneLine = (value: unknown, max: number): string =>
    String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

const isRecent = (timestamp: unknown): boolean => {
    const t = Date.parse(String(timestamp ?? ''))
    if (Number.isNaN(t)) return false
    const diff = Date.now() - t
    return diff <= EVENT_MAX_AGE_MS && diff > -5 * 60 * 1000
}

// ── Authentifizierung des Aufrufers ─────────────────────────────────────────
const encoder = new TextEncoder()
function safeEqual(a: string, b: string): boolean {
    const ab = encoder.encode(a)
    const bb = encoder.encode(b)
    if (ab.length !== bb.length || ab.length === 0) return false
    let diff = 0
    for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
    return diff === 0
}

function decodeJwtPayload(token: string): any {
    try {
        const part = token.split('.')[1]
        if (!part) return null
        const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
        return JSON.parse(atob(b64))
    } catch (_err) {
        return null
    }
}

async function isInternalCall(req: Request): Promise<boolean> {
    const header = req.headers.get('Authorization') || ''
    const token = header.replace(/^Bearer\s+/i, '').trim()

    const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') || ''
    if (webhookSecret) {
        const headerSecret = req.headers.get('x-webhook-secret') || ''
        if (safeEqual(headerSecret, webhookSecret) || safeEqual(token, webhookSecret)) return true
    }
    if (!token) return false

    // Schneller Weg: exakt der service_role-Schlüssel dieses Projekts (so ruft notify_push auf)
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (serviceKey && safeEqual(token, serviceKey)) return true

    // Rückfallweg nach Schlüsseltausch: nur Schlüssel, die wie ein Service-Schlüssel aussehen,
    // werden von Supabase Auth geprüft (Admin-Endpunkt antwortet nur für echte Service-Schlüssel mit 200).
    const claims = decodeJwtPayload(token)
    const looksLikeServiceKey = token.startsWith('sb_secret_') || claims?.role === 'service_role'
    if (!looksLikeServiceKey) return false
    try {
        const res = await fetch(`${Deno.env.get('SUPABASE_URL') ?? ''}/auth/v1/admin/users?page=1&per_page=1`, {
            headers: { apikey: token, Authorization: `Bearer ${token}` },
        })
        await res.body?.cancel()
        return res.ok
    } catch (_err) {
        return false
    }
}

// ── FCM HTTP v1 API ─────────────────────────────────────────────
// Uses a service account key stored in Supabase secrets

let cachedAccessToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(serviceAccount: any): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000)
    if (cachedAccessToken && cachedAccessToken.expiresAt - 60 > nowSec) {
        return cachedAccessToken.token
    }

    // Create JWT for Google OAuth2
    const header = { alg: 'RS256', typ: 'JWT' }
    const claim = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: nowSec,
        exp: nowSec + 3600,
    }

    // Base64url encode
    const b64url = (obj: any) => {
        const jsonStr = JSON.stringify(obj)
        const b64 = btoa(jsonStr)
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }

    const headerB64 = b64url(header)
    const claimB64 = b64url(claim)
    const unsignedJwt = `${headerB64}.${claimB64}`

    // Import RSA private key and sign
    const pemContents = String(serviceAccount.private_key || '')
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\\n/g, '')
        .replace(/\s+/g, '')

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
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }),
    })

    const tokenData = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || !tokenData.access_token) {
        throw new Error(`Google OAuth token request failed (HTTP ${tokenRes.status}${tokenData.error ? `, ${tokenData.error}` : ''})`)
    }
    cachedAccessToken = {
        token: tokenData.access_token,
        expiresAt: nowSec + (Number(tokenData.expires_in) || 3600),
    }
    return tokenData.access_token
}

interface FcmResult {
    ok: boolean
    status?: number
    errorCode?: string
    message?: string
}

async function sendFcmMessage(
    accessToken: string,
    projectId: string,
    fcmToken: string,
    title: string,
    body: string,
    data: Record<string, string> = {}
): Promise<FcmResult> {
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

    if (res.ok) {
        await res.body?.cancel()
        return { ok: true }
    }
    const errJson = await res.json().catch(() => ({}))
    const details: any[] = Array.isArray(errJson?.error?.details) ? errJson.error.details : []
    const errorCode = details.find((d: any) => d?.errorCode)?.errorCode || errJson?.error?.status || ''
    return { ok: false, status: res.status, errorCode, message: String(errJson?.error?.message || '') }
}

// Tokens, die dauerhaft ungültig sind, werden aus push_subscriptions entfernt
const isDeadToken = (r: FcmResult) =>
    r.errorCode === 'UNREGISTERED' ||
    r.errorCode === 'SENDER_ID_MISMATCH' ||
    (r.errorCode === 'INVALID_ARGUMENT' && /registration token/i.test(r.message || ''))

// ── Hilfsabfragen ───────────────────────────────────────────────
async function loadFreshRow(client: any, table: string, columns: string, id: unknown) {
    if (!isUuid(id)) return null
    const { data, error } = await client.from(table).select(columns).eq('id', id).maybeSingle()
    if (error) {
        console.error(`Lookup ${table} failed:`, error.message)
        return null
    }
    if (!data || !isRecent(data.created_at)) return null
    return data
}

async function getPropertyOwner(client: any, propertyId: unknown): Promise<string | null> {
    if (!isUuid(propertyId)) return null
    const { data } = await client
        .from('properties')
        .select('portfolio:portfolios(user_id)')
        .eq('id', propertyId)
        .maybeSingle()
    return (data as any)?.portfolio?.user_id || null
}

async function getRole(client: any, userId: unknown) {
    if (!isUuid(userId)) return null
    const { data } = await client
        .from('user_roles')
        .select('role, tenant_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle()
    return data || null
}

async function getTenantName(client: any, tenantId: unknown): Promise<string> {
    if (!isUuid(tenantId)) return ''
    const { data } = await client
        .from('tenants')
        .select('first_name, last_name')
        .eq('id', tenantId)
        .maybeSingle()
    return data ? oneLine(`${data.first_name || ''} ${data.last_name || ''}`, 80) : ''
}

interface PushContent {
    title: string
    body: string
    targetUserIds: string[]
    data: Record<string, string>
}

// ── Webhook-Ereignisse (Datensatz frisch aus der DB) ─────────────
async function buildFromWebhook(client: any, table: string, record: any): Promise<PushContent | null> {
    switch (table) {
        case 'messages': {
            const msg = await loadFreshRow(client, 'messages', 'id, sender_id, receiver_id, ticket_id, text, created_at', record?.id)
            // Don't notify sender
            if (!msg || !msg.receiver_id || msg.receiver_id === msg.sender_id) return null

            // Look up sender name
            let senderName = 'Hausverwaltung'
            const senderRole = await getRole(client, msg.sender_id)
            if (senderRole?.role === 'tenant' && senderRole?.tenant_id) {
                senderName = (await getTenantName(client, senderRole.tenant_id)) || senderName
            }
            const receiverRole = await getRole(client, msg.receiver_id)
            const receiverIsTenant = receiverRole?.role === 'tenant'
            const text = oneLine(msg.text, 100)

            // Check if it's a ticket comment
            if (msg.ticket_id) {
                return {
                    title: HIDE_CONTENT ? '💬 Neuer Ticket-Kommentar' : `💬 ${senderName}`,
                    body: HIDE_CONTENT ? 'Es gibt einen neuen Kommentar zu einem Ticket.' : (text || 'Neuer Kommentar zum Ticket'),
                    targetUserIds: [msg.receiver_id],
                    data: { route: receiverIsTenant ? '/tenant/tickets' : '/ticket-board', type: 'ticket_comment' },
                }
            }
            return {
                title: HIDE_CONTENT ? '💬 Neue Nachricht' : senderName,
                body: HIDE_CONTENT ? 'Sie haben eine neue Nachricht erhalten.' : (text || 'Hat Ihnen eine Nachricht gesendet.'),
                targetUserIds: [msg.receiver_id],
                data: { route: receiverIsTenant ? '/tenant/messages' : '/investor-messages', type: 'message' },
            }
        }

        case 'tickets': {
            // Notify the property owner (investor) – über das Objekt des Tickets
            const ticket = await loadFreshRow(client, 'tickets', 'id, title, property_id, tenant_user_id, created_at', record?.id)
            if (!ticket) return null
            const ownerId = await getPropertyOwner(client, ticket.property_id)
            if (!ownerId || ownerId === ticket.tenant_user_id) return null
            const title = oneLine(ticket.title, 80)
            return {
                title: '🎫 Neues Ticket',
                body: HIDE_CONTENT || !title ? 'Ein neues Ticket wurde erstellt.' : `"${title}" wurde erstellt.`,
                targetUserIds: [ownerId],
                data: { route: '/ticket-board', type: 'ticket', ticket_id: String(ticket.id) },
            }
        }

        case 'announcements': {
            // Notify all tenants of the property
            const ann = await loadFreshRow(client, 'announcements', 'id, property_id, title, created_by, created_at', record?.id)
            if (!ann || !isUuid(ann.property_id)) return null
            const { data: roles } = await client
                .from('user_roles')
                .select('user_id')
                .eq('property_id', ann.property_id)
                .eq('role', 'tenant')
            const targets = (roles || []).map((r: any) => r.user_id).filter((id: string) => id !== ann.created_by)
            return {
                title: '📢 Neuer Aushang',
                body: HIDE_CONTENT ? 'Ein neuer Aushang wurde veröffentlicht.' : (oneLine(ann.title, 100) || 'Ein neuer Aushang wurde erstellt.'),
                targetUserIds: targets,
                data: { route: '/tenant/announcements', type: 'announcement' },
            }
        }

        case 'documents': {
            // Notify tenants if document is for a specific unit
            const doc = await loadFreshRow(client, 'documents', 'id, unit_id, name, created_at', record?.id)
            if (!doc || !isUuid(doc.unit_id)) return null
            const { data: leases } = await client
                .from('leases')
                .select('tenant_id')
                .eq('unit_id', doc.unit_id)
                .eq('status', 'active')
            const tenantIds = [...new Set((leases || []).map((l: any) => l.tenant_id).filter(isUuid))]
            if (tenantIds.length === 0) return null
            const { data: roles } = await client
                .from('user_roles')
                .select('user_id')
                .in('tenant_id', tenantIds)
                .eq('role', 'tenant')
            return {
                title: '📄 Neues Dokument',
                body: HIDE_CONTENT ? 'Ein neues Dokument wurde bereitgestellt.' : (oneLine(doc.name, 100) || 'Ein neues Dokument wurde hochgeladen.'),
                targetUserIds: (roles || []).map((r: any) => r.user_id),
                data: { route: '/tenant/documents', type: 'document' },
            }
        }

        case 'user_roles': {
            // Tenant just registered - notify the investor/owner
            const role = await loadFreshRow(client, 'user_roles', 'id, user_id, role, tenant_id, property_id, created_at', record?.id)
            if (!role || role.role !== 'tenant' || !isUuid(role.property_id)) return null
            const ownerId = await getPropertyOwner(client, role.property_id)
            if (!ownerId || ownerId === role.user_id) return null
            const tenantName = HIDE_CONTENT ? '' : await getTenantName(client, role.tenant_id)
            return {
                title: '✅ Mieter registriert',
                body: tenantName
                    ? `${tenantName} hat sich erfolgreich registriert.`
                    : 'Ein Mieter hat sich erfolgreich im Portal registriert.',
                targetUserIds: [ownerId],
                data: { route: '/tenant-management', type: 'registration' },
            }
        }

        default:
            return null
    }
}

// ── Direkter interner Aufruf ─────────────────────────────────────
function buildFromDirectCall(payload: any): PushContent {
    const targetUserIds = Array.isArray(payload.user_ids)
        ? payload.user_ids.filter(isUuid).slice(0, MAX_DIRECT_TARGETS)
        : []
    const data: Record<string, string> = {}
    if (payload.data && typeof payload.data === 'object') {
        for (const [key, value] of Object.entries(payload.data).slice(0, 10)) {
            if (!/^[a-z_][a-z0-9_]{0,39}$/i.test(key) || value === null || value === undefined) continue
            data[key] = String(value).slice(0, 200)
        }
    }
    // Nur App-interne Routen
    if (data.route && (!data.route.startsWith('/') || data.route.startsWith('//'))) delete data.route
    return {
        title: oneLine(payload.title, 100) || 'ImmoControl Pro 360',
        body: oneLine(payload.body, 240),
        targetUserIds,
        data,
    }
}

// ── MAIN HANDLER ────────────────────────────────────────────────
serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    if (!(await isInternalCall(req))) {
        return json({ error: 'Unauthorized' }, 401)
    }

    try {
        let payload: any
        try {
            payload = await req.json()
        } catch (_err) {
            return json({ error: 'Invalid payload' }, 400)
        }

        const serviceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT_KEY')
        if (!serviceAccountJson) {
            throw new Error('FCM_SERVICE_ACCOUNT_KEY secret not set')
        }

        const serviceAccount = JSON.parse(serviceAccountJson)
        const projectId = serviceAccount.project_id

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            { auth: { persistSession: false, autoRefreshToken: false } }
        )

        // Payload structure:
        // { event_type: string, title: string, body: string, user_ids: string[], data?: {} }
        // OR called from database webhook (notify_push):
        // { type: 'INSERT', table: string, record: {} }
        let content: PushContent | null = null

        if (payload?.type && payload?.table && payload?.record) {
            if (payload.type !== 'INSERT') return json({ sent: 0, skipped: true })
            content = await buildFromWebhook(supabaseClient, String(payload.table), payload.record)
        } else if (payload?.event_type) {
            content = buildFromDirectCall(payload)
        } else {
            return json({ error: 'Invalid payload' }, 400)
        }

        const targetUserIds = [...new Set((content?.targetUserIds || []).filter(isUuid))]
        if (!content || targetUserIds.length === 0 || !content.title) {
            return json({ sent: 0, skipped: true })
        }

        // ── Get FCM tokens for target users ──
        const { data: subscriptions, error: subError } = await supabaseClient
            .from('push_subscriptions')
            .select('fcm_token')
            .in('user_id', targetUserIds)
        if (subError) throw new Error(`Subscription lookup failed: ${subError.message}`)

        const tokens = [...new Set((subscriptions || []).map((s: any) => s.fcm_token).filter(Boolean))] as string[]
        if (tokens.length === 0) {
            return json({ sent: 0, skipped: true })
        }

        // ── Get access token ──
        const accessToken = await getAccessToken(serviceAccount)

        // ── Send to all tokens (parallel) ──
        const results = await Promise.allSettled(
            tokens.map(token => sendFcmMessage(accessToken, projectId, token, content!.title, content!.body, content!.data))
        )

        let sent = 0
        let failed = 0
        const deadTokens: string[] = []
        results.forEach((r, i) => {
            if (r.status === 'fulfilled' && r.value.ok) {
                sent++
                return
            }
            failed++
            if (r.status === 'fulfilled') {
                console.warn(`FCM send failed (HTTP ${r.value.status}, ${r.value.errorCode || 'unknown'})`)
                if (isDeadToken(r.value)) deadTokens.push(tokens[i])
            } else {
                console.warn('FCM send error:', r.reason?.message || r.reason)
            }
        })

        let removed = 0
        if (deadTokens.length > 0) {
            const { error: delError } = await supabaseClient
                .from('push_subscriptions')
                .delete()
                .in('fcm_token', deadTokens)
            if (delError) console.error('Removing dead FCM tokens failed:', delError.message)
            else removed = deadTokens.length
        }

        // Nur Zähler zurückgeben – keine Tokens oder rohen FCM-Antworten
        return json({ sent, failed, removed })

    } catch (error: any) {
        console.error('Push notification error:', error?.message || error)
        return json({ error: 'Push notification failed' }, 500)
    }
})
