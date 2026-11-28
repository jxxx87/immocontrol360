// cloud-auth: OAuth-Verknüpfung von OneDrive / Google Drive
// Aktionen:
//   'config'     – liefert Version, PKCE-Unterstützung und die Scopes (für CloudSettings.jsx)
//   'exchange'   – tauscht den Autorisierungscode gegen Tokens (Standard, wenn code gesetzt ist)
//   'disconnect' – entfernt eine eigene Verbindung und widerruft (Google) die Berechtigung
//
// Komplett-Check 2026-11-27, Paket CLOUD:
// - Nutzer nur aus dem Authorization-Header (Vertrag C2); role=anon zählt nicht als angemeldet.
// - redirectUri wird gegen eine Allow-List geprüft; PKCE (code_verifier) wird weitergereicht.
//   Der state-Wert wird im Browser (sessionStorage) erzeugt und im Callback geprüft.
// - Tokens werden per service_role gespeichert und NIE an den Browser zurückgegeben.
// - Erneutes Verbinden desselben Kontos aktualisiert die vorhandene Zeile statt eine zweite anzulegen.
// - Kleinere Scopes: OneDrive Files.ReadWrite (statt Files.ReadWrite.All), Google drive.file.
//   Bestehende Verbindungen behalten ihre Berechtigung, niemand muss neu verbinden.
//
// Wave 3 (2026-11-27), Paket 08 CLOUD:
// - M2-06: Tokens werden über cloud_store_tokens im Supabase Vault gespeichert (Rückfall auf die
//   alten Spalten, solange die Migration fehlt); die neue Zeile wird zuerst ohne Tokens angelegt.
// - CLOUD-unique: Ein paralleler zweiter Callback desselben Kontos (Unique-Verletzung 23505) wird
//   als "vorhandene Verbindung aktualisieren" behandelt statt abzubrechen.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

// ---------------------------------------------------------------------------
// Gemeinsamer Block A – identisch in cloud-auth, cloud-drive und cloud-sync.
// (Bewusst je Function eingebettet, damit jede Function als Einzeldatei deploybar bleibt.)
// ---------------------------------------------------------------------------

class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// Erlaubte Browser-Origins. Ergänzungen ohne Redeploy über das Secret CLOUD_ALLOWED_ORIGINS
// (kommagetrennt, '*' = alle Origins zulassen – nur als Notbehelf).
const DEFAULT_ALLOWED_ORIGINS = [
  'https://app.immocontrol360.de',
  'https://immocontrol360.de',
  'https://www.immocontrol360.de',
  'https://localhost', // Android-App (Capacitor, androidScheme https)
  'capacitor://localhost',
  'http://localhost',
]

const isAllowedOrigin = (origin: string): boolean => {
  if (!origin) return false
  const extra = (Deno.env.get('CLOUD_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (extra.includes('*')) return true
  if (DEFAULT_ALLOWED_ORIGINS.includes(origin) || extra.includes(origin)) return true
  // Lokale Entwicklung (z. B. Vite auf http://localhost:5173)
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin)
}

const buildCorsHeaders = (req: Request): Record<string, string> => {
  const origin = req.headers.get('Origin') || ''
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

const jsonResponse = (body: unknown, status: number, corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// Fehler: Details nur ins Server-Log, an den Client nur Meldung + Code (kein Stacktrace)
const errorResponse = (error: unknown, corsHeaders: Record<string, string>, fn: string) => {
  if (error instanceof HttpError) {
    if (error.status >= 500) console.error(`[${fn}] ${error.code}: ${error.message}`)
    return jsonResponse({ error: error.message, code: error.code }, error.status, corsHeaders)
  }
  console.error(`[${fn}] Unerwarteter Fehler:`, error)
  return jsonResponse(
    { error: 'Interner Fehler bei der Cloud-Anbindung. Bitte versuchen Sie es später erneut.', code: 'internal_error' },
    500,
    corsHeaders,
  )
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
const SUPPORTED_PROVIDERS = ['onedrive', 'googledrive']

const getAdminClient = () => {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) throw new HttpError(500, 'server_config', 'Server-Konfiguration unvollständig.')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

const decodeJwtPayload = (jwt: string): Record<string, unknown> | null => {
  try {
    const part = jwt.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
  } catch {
    return null
  }
}

// Vertrag C2: angemeldet ist nur, wer ein gültiges Nutzer-JWT (role=authenticated) mitschickt.
// Die Vorprüfung der Claims ist nur ein schneller Ausschluss; maßgeblich ist getUser().
// deno-lint-ignore no-explicit-any
const requireUser = async (req: Request, admin: any) => {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') || '')
  const jwt = match ? match[1].trim() : ''
  const claims = jwt ? decodeJwtPayload(jwt) : null
  if (!claims || claims.role !== 'authenticated' || typeof claims.sub !== 'string') {
    throw new HttpError(401, 'not_authenticated', 'Nicht angemeldet. Bitte melden Sie sich erneut an.')
  }
  const { data, error } = await admin.auth.getUser(jwt)
  const user = data?.user
  if (error || !user || user.id !== claims.sub || (user.role && user.role !== 'authenticated')) {
    throw new HttpError(401, 'not_authenticated', 'Nicht angemeldet. Bitte melden Sie sich erneut an.')
  }
  return { user, jwt }
}

// OAuth-Tokens liegen verschlüsselt im Supabase Vault (Wave 3, Befund M2-06). Gelesen und geschrieben
// wird nur über die RPCs cloud_get_tokens / cloud_store_tokens (ausführbar nur für service_role).
// Solange die Migration noch nicht eingespielt ist (PostgREST kennt die Funktion nicht), gelten wie
// bisher die Spalten access_token/refresh_token. Fehlermeldungen werden nur mit Code geloggt.
// deno-lint-ignore no-explicit-any
const isMissingRpc = (error: any): boolean => error?.code === 'PGRST202' || error?.code === '42883'

type CloudTokens = { accessToken: string | null; refreshToken: string | null }

// deno-lint-ignore no-explicit-any
const readTokens = async (admin: any, connectionId: string, userId: string): Promise<CloudTokens> => {
  const { data, error } = await admin.rpc('cloud_get_tokens', { p_connection_id: connectionId, p_user_id: userId })
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data
    return { accessToken: row?.access_token || null, refreshToken: row?.refresh_token || null }
  }
  if (!isMissingRpc(error)) {
    console.error(`Cloud-Tokens lesen fehlgeschlagen (Verbindung ${connectionId}, Code ${error.code || '-'})`)
    throw new HttpError(500, 'db_error', 'Die Cloud-Verbindung konnte nicht geladen werden.')
  }
  const { data: legacy, error: legacyError } = await admin
    .from('cloud_connections')
    .select('access_token, refresh_token')
    .eq('id', connectionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (legacyError) {
    console.error(`Cloud-Tokens lesen fehlgeschlagen (Verbindung ${connectionId}, Code ${legacyError.code || '-'})`)
    throw new HttpError(500, 'db_error', 'Die Cloud-Verbindung konnte nicht geladen werden.')
  }
  return { accessToken: legacy?.access_token || null, refreshToken: legacy?.refresh_token || null }
}

// Speichert ein neues Access-Token (refreshToken null = bisheriges behalten) samt Ablaufzeit.
// Liefert false, wenn nicht gespeichert werden konnte (Ursache steht im Server-Log).
const storeTokens = async (
  // deno-lint-ignore no-explicit-any
  admin: any,
  connectionId: string,
  userId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: string,
): Promise<boolean> => {
  const { error } = await admin.rpc('cloud_store_tokens', {
    p_connection_id: connectionId,
    p_user_id: userId,
    p_access_token: accessToken,
    p_refresh_token: refreshToken,
    p_expires_at: expiresAt,
  })
  if (!error) return true
  if (!isMissingRpc(error)) {
    console.error(`Cloud-Tokens speichern fehlgeschlagen (Verbindung ${connectionId}, Code ${error.code || '-'})`)
    return false
  }
  const update: Record<string, string> = { access_token: accessToken, expires_at: expiresAt }
  if (refreshToken) update.refresh_token = refreshToken
  const { error: legacyError } = await admin
    .from('cloud_connections')
    .update(update)
    .eq('id', connectionId)
    .eq('user_id', userId)
  if (legacyError) {
    console.error(`Cloud-Tokens speichern fehlgeschlagen (Verbindung ${connectionId}, Code ${legacyError.code || '-'})`)
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Ende des gemeinsamen Blocks
// ---------------------------------------------------------------------------

const CONFIG_VERSION = 2
const ONEDRIVE_SCOPE = 'offline_access Files.ReadWrite User.Read'
// Ältere App-Stände autorisieren noch mit diesem Scope – der Token-Tausch muss dann denselben anfragen
const ONEDRIVE_SCOPE_LEGACY = 'offline_access Files.ReadWrite.All User.Read'
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file email'
const REDIRECT_PATHS = ['/settings/cloud/callback']
const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/

const TOKEN_URLS: Record<string, string> = {
  onedrive: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  googledrive: 'https://oauth2.googleapis.com/token',
}

// redirectUri nur für bekannte App-Origins und den Callback-Pfad akzeptieren
const isAllowedRedirectUri = (uri: unknown): uri is string => {
  if (typeof uri !== 'string' || uri.length > 500) return false
  let u: URL
  try {
    u = new URL(uri)
  } catch {
    return false
  }
  if (u.search || u.hash || u.username || u.password) return false
  return isAllowedOrigin(u.origin) && REDIRECT_PATHS.includes(u.pathname)
}

// deno-lint-ignore no-explicit-any
const readJsonSafe = async (res: Response): Promise<any> => {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

// Nur einfache OAuth-Fehlercodes (z. B. invalid_grant) an den Client weitergeben
const safeOAuthError = (value: unknown): string =>
  typeof value === 'string' && /^[a-z_]{1,64}$/.test(value) ? value : ''

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const respond = (body: unknown, status = 200) => jsonResponse(body, status, corsHeaders)
  const dbError = (label: string, error: { message?: string } | null) => {
    console.error(`[cloud-auth] ${label}:`, error?.message)
    return new HttpError(500, 'db_error', 'Die Cloud-Verbindung konnte nicht gespeichert werden.')
  }

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Methode nicht erlaubt.')
    const admin = getAdminClient()
    const { user } = await requireUser(req, admin)

    // deno-lint-ignore no-explicit-any
    let body: any
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'invalid_request', 'Ungültige Anfrage.')
    }
    // Ältere App-Stände schicken nur { provider, code, redirectUri }
    const action = typeof body?.action === 'string' ? body.action : body?.code ? 'exchange' : ''

    // ---------------------------------------------------------------- config
    if (action === 'config') {
      return respond({
        version: CONFIG_VERSION,
        pkce: true,
        scopes: { onedrive: ONEDRIVE_SCOPE, googledrive: GOOGLE_SCOPE },
      })
    }

    // ------------------------------------------------------------ disconnect
    if (action === 'disconnect') {
      const connectionId = body?.connectionId
      if (!isUuid(connectionId)) throw new HttpError(400, 'invalid_connection', 'Ungültige Verbindungs-ID.')

      const { data: connection, error } = await admin
        .from('cloud_connections')
        .select('id, provider, account_email')
        .eq('id', connectionId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (error) throw dbError('Verbindung laden', error)
      if (!connection) throw new HttpError(404, 'connection_not_found', 'Die Cloud-Verbindung wurde nicht gefunden.')

      let revoked = false
      let revokeNote = ''
      if (connection.provider === 'googledrive') {
        // Nicht widerrufen, solange dieselbe Google-Freigabe noch in einer anderen Verbindung steckt
        let sharedGrant = false
        if (connection.account_email) {
          const { count, error: countError } = await admin
            .from('cloud_connections')
            .select('id', { count: 'exact', head: true })
            .eq('provider', 'googledrive')
            .eq('account_email', connection.account_email)
            .neq('id', connection.id)
          sharedGrant = !!countError || (count ?? 0) > 0
        }
        let token: string | null = null
        if (!sharedGrant) {
          try {
            const tokens = await readTokens(admin, connection.id, user.id)
            token = tokens.refreshToken || tokens.accessToken
          } catch {
            // Ohne lesbares Token kein Widerruf – Hinweis auf manuellen Widerruf (revokeNote)
            token = null
          }
        }
        if (!sharedGrant && token) {
          try {
            const res = await fetch('https://oauth2.googleapis.com/revoke', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ token }),
            })
            revoked = res.ok
            if (!res.ok) console.error(`[cloud-auth] Google-Widerruf fehlgeschlagen (Status ${res.status})`)
            await res.body?.cancel()
          } catch (e) {
            console.error('[cloud-auth] Google-Widerruf nicht möglich:', e instanceof Error ? e.message : e)
          }
        }
        if (!revoked) revokeNote = 'google_manual'
      } else {
        // Microsoft bietet keinen Widerruf einzelner App-Freigaben per API für den Nutzer
        revokeNote = 'microsoft_manual'
      }

      const { error: deleteError } = await admin
        .from('cloud_connections')
        .delete()
        .eq('id', connection.id)
        .eq('user_id', user.id)
      if (deleteError) throw dbError('Verbindung löschen', deleteError)

      return respond({ success: true, provider: connection.provider, revoked, revokeNote })
    }

    // -------------------------------------------------------------- exchange
    if (action !== 'exchange') throw new HttpError(400, 'invalid_action', 'Unbekannte Aktion.')

    const provider = body?.provider
    if (typeof provider !== 'string' || !SUPPORTED_PROVIDERS.includes(provider)) {
      throw new HttpError(400, 'invalid_provider', 'Unbekannter Cloud-Anbieter.')
    }
    const code = body?.code
    if (typeof code !== 'string' || code.length === 0 || code.length > 4096) {
      throw new HttpError(400, 'invalid_code', 'Ungültiger Autorisierungscode.')
    }
    const redirectUri = body?.redirectUri
    if (!isAllowedRedirectUri(redirectUri)) {
      throw new HttpError(400, 'invalid_redirect_uri', 'Ungültige Rücksprung-Adresse.')
    }
    const codeVerifier = body?.codeVerifier
    const hasVerifier = typeof codeVerifier === 'string' && codeVerifier.length > 0
    if (hasVerifier && !PKCE_VERIFIER_RE.test(codeVerifier)) {
      throw new HttpError(400, 'invalid_code_verifier', 'Ungültiger PKCE-Wert.')
    }

    const isGoogle = provider === 'googledrive'
    const clientId = Deno.env.get(isGoogle ? 'GOOGLE_CLIENT_ID' : 'ONEDRIVE_CLIENT_ID')
    const clientSecret = Deno.env.get(isGoogle ? 'GOOGLE_CLIENT_SECRET' : 'ONEDRIVE_CLIENT_SECRET')
    if (!clientId || !clientSecret) {
      throw new HttpError(500, 'server_config', 'Server-Konfiguration für den Cloud-Anbieter unvollständig.')
    }

    const params: Record<string, string> = {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }
    // Der Token-Tausch muss denselben Scope anfragen wie die Autorisierung. Ältere App-Stände schicken
    // keinen scope mit und haben mit dem alten Scope autorisiert.
    if (!isGoogle) params.scope = body?.scope === ONEDRIVE_SCOPE ? ONEDRIVE_SCOPE : ONEDRIVE_SCOPE_LEGACY
    if (hasVerifier) params.code_verifier = codeVerifier

    let res: Response
    try {
      res = await fetch(TOKEN_URLS[provider], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
      })
    } catch (e) {
      console.error('[cloud-auth] Token-Tausch: Anbieter nicht erreichbar', e)
      throw new HttpError(424, 'provider_unreachable', 'Der Cloud-Anbieter ist derzeit nicht erreichbar.')
    }
    const tokenResponse = await readJsonSafe(res)
    if (!res.ok || tokenResponse.error || !tokenResponse.access_token) {
      const oauthError = safeOAuthError(tokenResponse.error)
      console.error(`[cloud-auth] Token-Tausch fehlgeschlagen (${provider}, Status ${res.status}, Fehler ${oauthError || '-'})`)
      throw new HttpError(
        400,
        'oauth_exchange_failed',
        `Der Anmeldecode konnte nicht eingelöst werden${oauthError ? ` (${oauthError})` : ''}. Bitte starten Sie die Verbindung erneut.`,
      )
    }

    // Konto-E-Mail ermitteln (nur zur Anzeige und zum Wiedererkennen desselben Kontos)
    let accountEmail: string | null = null
    try {
      const meRes = await fetch(
        isGoogle ? 'https://www.googleapis.com/oauth2/v2/userinfo' : 'https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail',
        { headers: { Authorization: `Bearer ${tokenResponse.access_token}` } },
      )
      const me = await readJsonSafe(meRes)
      const email = isGoogle ? me?.email : me?.userPrincipalName || me?.mail
      if (meRes.ok && typeof email === 'string' && email.length > 0 && email.length <= 320) accountEmail = email
    } catch (e) {
      console.error('[cloud-auth] Konto-E-Mail nicht abrufbar:', e instanceof Error ? e.message : e)
    }

    const expiresIn = Number(tokenResponse.expires_in)
    const expiresAt = new Date(
      Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    ).toISOString()

    const accessToken: string = tokenResponse.access_token
    const refreshToken: string | null =
      typeof tokenResponse.refresh_token === 'string' && tokenResponse.refresh_token ? tokenResponse.refresh_token : null

    // Vorhandene Verbindung(en) desselben Kontos (nur eigene) – älteste zuerst
    const findExisting = async (): Promise<string[]> => {
      if (!accountEmail) return []
      const { data: existing, error: existingError } = await admin
        .from('cloud_connections')
        .select('id')
        .eq('user_id', user.id)
        .eq('provider', provider)
        .eq('account_email', accountEmail)
        .order('created_at', { ascending: true })
      if (existingError) throw dbError('Vorhandene Verbindung suchen', existingError)
      // deno-lint-ignore no-explicit-any
      return (existing || []).map((r: any) => String(r.id))
    }
    const updateExisting = async (ids: string[]) => {
      for (const id of ids) {
        const stored = await storeTokens(admin, id, user.id, accessToken, refreshToken, expiresAt)
        if (!stored) throw new HttpError(500, 'db_error', 'Die Cloud-Verbindung konnte nicht gespeichert werden.')
      }
      return ids[0]
    }

    // Gleiches Konto erneut verbunden -> vorhandene Zeile aktualisieren statt eine neue anzulegen
    let connectionId: string | null = null
    const existingIds = await findExisting()
    if (existingIds.length > 0) connectionId = await updateExisting(existingIds)

    if (!connectionId) {
      // Zeile zuerst ohne Tokens anlegen, Tokens danach verschlüsselt speichern
      const { data: inserted, error: insertError } = await admin
        .from('cloud_connections')
        .insert({ user_id: user.id, provider, account_email: accountEmail, expires_at: expiresAt })
        .select('id')
        .single()
      if (insertError?.code === '23505') {
        // Ein zweiter, gleichzeitiger Callback hat dieselbe Verbindung eben angelegt -> diese aktualisieren
        const raceIds = await findExisting()
        if (raceIds.length === 0) throw dbError('Verbindung speichern', insertError)
        connectionId = await updateExisting(raceIds)
      } else {
        if (insertError || !inserted) throw dbError('Verbindung speichern', insertError)
        const newId = String(inserted.id)
        if (!(await storeTokens(admin, newId, user.id, accessToken, refreshToken, expiresAt))) {
          // Keine Verbindung ohne Tokens zurücklassen
          await admin.from('cloud_connections').delete().eq('id', newId).eq('user_id', user.id)
          throw new HttpError(500, 'db_error', 'Die Cloud-Verbindung konnte nicht gespeichert werden.')
        }
        connectionId = newId
      }
    }

    // Keine Tokens in der Antwort
    return respond({ success: true, email: accountEmail || '', connectionId })
  } catch (error) {
    return errorResponse(error, corsHeaders, 'cloud-auth')
  }
})
