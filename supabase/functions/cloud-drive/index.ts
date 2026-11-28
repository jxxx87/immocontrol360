// cloud-drive: Datei-Proxy zu Microsoft OneDrive / Google Drive
// Aktionen: list, upload, get_download_link, delete, create_folder, move
//
// Wave 3 (2026-11-27), Paket 08 CLOUD:
// - M2-06: Tokens nur noch über cloud_get_tokens/cloud_store_tokens (Vault), Rückfall auf die alten
//   Spalten, solange die Migration fehlt.
// - G12a-15: neue Aktion 'move' { fromPath, toPath } benennt einen ORDNER innerhalb des App-Ordners um
//   bzw. verschiebt ihn (nach Umbenennen von Objekt/Einheit, damit Bilder/Dokumente nicht verwaisen).
//   Gemerkte Ordner der Mietverhältnisse (lease_cloud_folders) werden dabei nachgeführt.
//
// Sicherheit (Komplett-Check 2026-11-27, Paket CLOUD):
// - Der Nutzer wird ausschließlich aus dem Authorization-Header abgeleitet (Vertrag C2):
//   getUser(jwt) mit dem Service-Client; ein JWT mit role=anon zählt nicht als angemeldet.
//   Ein user_id-Feld im Body wird ignoriert.
// - Die Verbindung wird per connectionId (oder ersatzweise per Anbieter) NUR unter den eigenen
//   Verbindungen gesucht. Tokens werden serverseitig per service_role gelesen/geschrieben und nie
//   an den Browser zurückgegeben.
// - Pfade und Element-IDs werden geprüft; Löschen/Download per ID nur innerhalb des App-Ordners.
// - Löschen verschiebt bei beiden Anbietern in den Papierkorb (Google: trashed=true statt DELETE).
// - Fehlerdetails nur ins Server-Log, an den Client Meldung + Fehlercode + passender HTTP-Status.
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
// Gemeinsamer Block B – identisch in cloud-drive und cloud-sync
// (Verbindung laden, Token erneuern, Anbieter-Aufrufe mit Drosselungs-Behandlung)
// ---------------------------------------------------------------------------

const APP_FOLDER = 'ImmoControlpro360'
const INVALID_ONEDRIVE_CHARS = /["*:<>?\/\\|]/g
// deno-lint-ignore no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
// Ohne Token-Spalten: Tokens kommen ausschließlich über readTokens (Block A)
const CONNECTION_COLUMNS = 'id, user_id, provider, account_email, expires_at, created_at'
const RECONNECT_MESSAGE =
  'Die Cloud-Verbindung ist abgelaufen oder wurde widerrufen. Bitte verbinden Sie das Konto unter Einstellungen > Cloud neu.'

const TOKEN_ENDPOINTS: Record<string, string> = {
  onedrive: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  googledrive: 'https://oauth2.googleapis.com/token',
}

// Escaping für Google-Drive-Suchausdrücke (q): erst Backslash, dann Hochkomma
const gq = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

// Tabelle/Spalte (noch) nicht vorhanden, z. B. lease_cloud_folders vor dem Einspielen der Migration
// deno-lint-ignore no-explicit-any
const isMissingTable = (error: any): boolean =>
  ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(error?.code || ''))

// Pfad wie in der App gebildet (Segmente mit '/'), ohne leere Segmente; null = ungültig
const normalizeRawPath = (p: unknown): string | null => {
  if (typeof p !== 'string' || p.length > 2000) return null
  const segments = p.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) return null
  if (segments.some((s) => s === '.' || s === '..' || CONTROL_CHARS.test(s))) return null
  return segments.join('/')
}

// Lädt eine Verbindung NUR aus den eigenen Verbindungen des Nutzers.
// Mit connectionId: genau diese; sonst die älteste Verbindung des Anbieters (deterministisch).
// deno-lint-ignore no-explicit-any
const loadConnection = async (admin: any, userId: string, connectionId: unknown, provider: unknown) => {
  if (connectionId !== undefined && connectionId !== null && connectionId !== '') {
    if (!isUuid(connectionId)) throw new HttpError(400, 'invalid_connection', 'Ungültige Verbindungs-ID.')
    const { data, error } = await admin
      .from('cloud_connections')
      .select(CONNECTION_COLUMNS)
      .eq('id', connectionId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('cloud_connections lesen fehlgeschlagen:', error.message)
      throw new HttpError(500, 'db_error', 'Die Cloud-Verbindung konnte nicht geladen werden.')
    }
    if (!data) throw new HttpError(404, 'connection_not_found', 'Die gewählte Cloud-Verbindung wurde nicht gefunden.')
    return data
  }
  if (typeof provider !== 'string' || !SUPPORTED_PROVIDERS.includes(provider)) {
    throw new HttpError(400, 'invalid_provider', 'Unbekannter Cloud-Anbieter.')
  }
  const { data, error } = await admin
    .from('cloud_connections')
    .select(CONNECTION_COLUMNS)
    .eq('user_id', userId)
    .eq('provider', provider)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) {
    console.error('cloud_connections lesen fehlgeschlagen:', error.message)
    throw new HttpError(500, 'db_error', 'Die Cloud-Verbindung konnte nicht geladen werden.')
  }
  if (!data || data.length === 0) {
    throw new HttpError(404, 'no_connection', 'Keine aktive Cloud-Verbindung für diesen Anbieter gefunden.')
  }
  return data[0]
}

// Liefert ein gültiges Access-Token; erneuert es bei Bedarf und speichert es (Vault) per service_role.
// deno-lint-ignore no-explicit-any
const getValidAccessToken = async (admin: any, connection: any): Promise<string> => {
  const tokens = await readTokens(admin, connection.id, connection.user_id)
  const expiresAtMs = connection.expires_at ? Date.parse(connection.expires_at) : NaN
  if (tokens.accessToken && Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > 5 * 60 * 1000) {
    return tokens.accessToken
  }
  if (!tokens.refreshToken) throw new HttpError(409, 'reconnect_required', RECONNECT_MESSAGE)

  const isGoogle = connection.provider === 'googledrive'
  const clientId = Deno.env.get(isGoogle ? 'GOOGLE_CLIENT_ID' : 'ONEDRIVE_CLIENT_ID')
  const clientSecret = Deno.env.get(isGoogle ? 'GOOGLE_CLIENT_SECRET' : 'ONEDRIVE_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new HttpError(500, 'server_config', 'Server-Konfiguration für den Cloud-Anbieter unvollständig.')
  }

  let res: Response
  try {
    res = await fetch(TOKEN_ENDPOINTS[connection.provider], {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
  } catch (e) {
    console.error('Token-Erneuerung: Anbieter nicht erreichbar', e)
    throw new HttpError(424, 'provider_unreachable', 'Der Cloud-Anbieter ist derzeit nicht erreichbar.')
  }
  // deno-lint-ignore no-explicit-any
  let tokenResponse: any = {}
  try {
    tokenResponse = await res.json()
  } catch {
    tokenResponse = {}
  }
  if (!res.ok || tokenResponse.error || !tokenResponse.access_token) {
    console.error(
      `Token-Erneuerung fehlgeschlagen (Verbindung ${connection.id}, Status ${res.status}, Fehler ${tokenResponse.error || '-'})`,
    )
    if (tokenResponse.error === 'invalid_grant') throw new HttpError(409, 'reconnect_required', RECONNECT_MESSAGE)
    throw new HttpError(
      424,
      'token_refresh_failed',
      'Die Anmeldung beim Cloud-Anbieter konnte nicht erneuert werden. Bitte versuchen Sie es später erneut.',
    )
  }

  const expiresIn = Number(tokenResponse.expires_in)
  const newExpiresAt = new Date(
    Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
  ).toISOString()
  // Fehler beim Speichern sind hier nicht fatal: das neue Token gilt für diesen Aufruf trotzdem
  await storeTokens(
    admin,
    connection.id,
    connection.user_id,
    tokenResponse.access_token,
    typeof tokenResponse.refresh_token === 'string' && tokenResponse.refresh_token ? tokenResponse.refresh_token : null,
    newExpiresAt,
  )
  connection.expires_at = newExpiresAt
  return tokenResponse.access_token
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Wiederholt bei Drosselung (429/503) bis zu 3 Versuche und beachtet Retry-After (max. 10 s).
const fetchWithRetry = async (url: string, init: RequestInit, attempts = 3): Promise<Response> => {
  for (let attempt = 1; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (e) {
      // Nur den Fehlertyp loggen – die Fehlermeldung enthält die URL (Pfade mit Objekt-/Mieternamen)
      console.error('Cloud-Anbieter nicht erreichbar:', e instanceof Error ? e.name : 'Fehler')
      throw new HttpError(424, 'provider_unreachable', 'Der Cloud-Anbieter ist derzeit nicht erreichbar.')
    }
    if ((res.status === 429 || res.status === 503) && attempt < attempts) {
      const retryAfter = Number(res.headers.get('Retry-After'))
      await res.body?.cancel()
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : 1000 * attempt)
      continue
    }
    return res
  }
}

const providerError = async (res: Response, label: string): Promise<HttpError> => {
  // Nur Status und Fehlercode loggen – die Fehlertexte der Anbieter können Datei-/Ordnernamen enthalten
  let detail = '-'
  try {
    const body = await res.json()
    const err = body?.error
    const code = typeof err === 'string' ? err : err?.code ?? err?.status ?? err?.errors?.[0]?.reason
    if (code !== undefined && code !== null) detail = String(code).slice(0, 80)
  } catch {
    detail = '-'
  }
  console.error(`${label}-Fehler (Status ${res.status}, Code ${detail})`)
  if (res.status === 401) return new HttpError(409, 'reconnect_required', RECONNECT_MESSAGE)
  if (res.status === 403) {
    return new HttpError(403, 'provider_forbidden', 'Der Cloud-Anbieter verweigert den Zugriff auf dieses Element.')
  }
  if (res.status === 429 || res.status === 503) {
    return new HttpError(
      429,
      'provider_throttled',
      'Der Cloud-Anbieter drosselt gerade die Anfragen. Bitte versuchen Sie es in einer Minute erneut.',
    )
  }
  if (res.status === 507) return new HttpError(424, 'quota_exceeded', 'Der Cloud-Speicher ist voll.')
  return new HttpError(424, 'provider_error', `Fehler beim Cloud-Anbieter (Status ${res.status}).`)
}

type CallOptions = {
  method?: string
  json?: unknown
  binary?: BodyInit
  headers?: Record<string, string>
  query?: Record<string, string>
  conflictOk?: boolean // 409 nicht als Fehler werfen, sondern { conflict: true } liefern
}

// Microsoft Graph: 404 -> null, 204 -> { success: true }
const makeGraphCall = (getToken: () => string) =>
  // deno-lint-ignore no-explicit-any
  async (endpoint: string, opts: CallOptions = {}): Promise<any> => {
    if (endpoint.startsWith('https://') && !endpoint.startsWith('https://graph.microsoft.com/')) {
      throw new HttpError(400, 'invalid_url', 'Ungültige Anbieter-Adresse.')
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${getToken()}`, ...(opts.headers || {}) }
    const init: RequestInit = { method: opts.method || 'GET', headers }
    if (opts.binary !== undefined) {
      init.body = opts.binary
    } else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(opts.json)
    }
    const url = endpoint.startsWith('https://') ? endpoint : `https://graph.microsoft.com/v1.0${endpoint}`
    const res = await fetchWithRetry(url, init)
    if (res.status === 404) {
      await res.body?.cancel()
      return null
    }
    if (res.status === 409 && opts.conflictOk) {
      await res.body?.cancel()
      return { conflict: true }
    }
    if (!res.ok) throw await providerError(res, 'Graph-API')
    if (res.status === 204) return { success: true }
    return await res.json()
  }

// Google Drive v3: 404 -> null, 204 -> { success: true }
const makeGoogleCall = (getToken: () => string) =>
  // deno-lint-ignore no-explicit-any
  async (endpoint: string, opts: CallOptions = {}): Promise<any> => {
    let url = `https://www.googleapis.com/drive/v3${endpoint}`
    if (opts.query) url += `?${new URLSearchParams(opts.query).toString()}`
    const headers: Record<string, string> = { Authorization: `Bearer ${getToken()}`, ...(opts.headers || {}) }
    const init: RequestInit = { method: opts.method || 'GET', headers }
    if (opts.binary !== undefined) {
      init.body = opts.binary
    } else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(opts.json)
    }
    const res = await fetchWithRetry(url, init)
    if (res.status === 404) {
      await res.body?.cancel()
      return null
    }
    if (!res.ok) throw await providerError(res, 'Google-Drive-API')
    if (res.status === 204) return { success: true }
    return await res.json()
  }

// ---------------------------------------------------------------------------
// Ende der gemeinsamen Blöcke
// ---------------------------------------------------------------------------

const ACTIONS = ['list', 'upload', 'get_download_link', 'delete', 'create_folder', 'move']
// OneDrive-IDs enthalten u. a. '!' (privat), Google-IDs nur [A-Za-z0-9_-]
const ITEM_ID_RE = /^[A-Za-z0-9!._-]{1,256}$/
const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'
const GOOGLE_FILE_FIELDS = 'id, name, mimeType, webViewLink, webContentLink, thumbnailLink, size, modifiedTime'

// Ein Namenssegment prüfen (bei OneDrive vorher unzulässige Zeichen entfernen wie bisher)
const cleanSegment = (raw: string, stripOneDriveChars: boolean): string => {
  const s = stripOneDriveChars ? raw.replace(INVALID_ONEDRIVE_CHARS, '') : raw
  if (!s || s === '.' || s === '..' || s.length > 255 || CONTROL_CHARS.test(s)) {
    throw new HttpError(400, 'invalid_name', 'Ungültiger Datei- oder Ordnername.')
  }
  return s
}

// Relativen Pfad unterhalb des App-Ordners in geprüfte Segmente zerlegen
const splitPath = (p: unknown, stripOneDriveChars: boolean): string[] => {
  if (p === undefined || p === null || p === '') return []
  if (typeof p !== 'string' || p.length > 2000) throw new HttpError(400, 'invalid_path', 'Ungültiger Ordnerpfad.')
  return p
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => cleanSegment(s, stripOneDriveChars))
}

const validateItemId = (itemId: unknown): string => {
  if (typeof itemId !== 'string' || !ITEM_ID_RE.test(itemId)) {
    throw new HttpError(400, 'invalid_item', 'Ungültige Element-ID.')
  }
  return itemId
}

// OneDrive: pfadbasierte Adresse mit kodierten Segmenten ('#', '%' usw. brechen die URL nicht mehr)
const oneDrivePath = (segments: string[]) =>
  `/me/drive/root:/${[APP_FOLDER, ...segments].map((s) => encodeURIComponent(s)).join('/')}`

// OneDrive: liegt das Element (über parentReference.path) innerhalb des App-Ordners?
// Der App-Ordner selbst zählt nicht dazu (darf nicht gelöscht werden).
// deno-lint-ignore no-explicit-any
const isInsideOneDriveAppFolder = (item: any): boolean => {
  const raw = item?.parentReference?.path
  if (typeof raw !== 'string') return false
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  const m = /^\/drives?\/(?:[^/]+\/)?root:(.*)$/i.exec(decoded)
  if (!m) return false
  const rel = m[1].toLowerCase()
  const app = `/${APP_FOLDER.toLowerCase()}`
  return rel === app || rel.startsWith(`${app}/`)
}

// 'move': Quelle und Ziel prüfen (je mindestens ein Segment, nicht in den eigenen Unterordner)
const checkMovePaths = (from: string[], to: string[]) => {
  if (from.length === 0 || to.length === 0) {
    throw new HttpError(400, 'invalid_path', 'Quell- und Zielordner müssen angegeben werden.')
  }
  const fromKey = from.join('/').toLowerCase()
  const toKey = to.join('/').toLowerCase()
  if (toKey.startsWith(`${fromKey}/`)) {
    throw new HttpError(400, 'invalid_target', 'Ein Ordner kann nicht in seinen eigenen Unterordner verschoben werden.')
  }
}

const sourceNotFound = { error: 'Der Ordner wurde in der Cloud nicht gefunden.', code: 'source_not_found' }
const targetParentNotFound = { error: 'Der Zielordner wurde in der Cloud nicht gefunden.', code: 'target_parent_not_found' }
const TARGET_EXISTS_MESSAGE = 'Am Ziel existiert bereits ein Ordner oder eine Datei mit diesem Namen.'

// Gemerkte Ordner der Mietverhältnisse (lease_cloud_folders) nach dem Umbenennen nachführen.
// Fehlt die Tabelle noch (Migration nicht eingespielt), passiert nichts.
// deno-lint-ignore no-explicit-any
const updateLeaseFolderPaths = async (admin: any, userId: string, connectionId: string, fromRaw: string, toRaw: string) => {
  const { data, error } = await admin
    .from('lease_cloud_folders')
    .select('lease_id, folder_path')
    .eq('user_id', userId)
    .eq('cloud_connection_id', connectionId)
  if (error) {
    if (!isMissingTable(error)) console.error(`Ordnerzuordnungen lesen fehlgeschlagen (Code ${error.code || '-'})`)
    return
  }
  const now = new Date().toISOString()
  // deno-lint-ignore no-explicit-any
  for (const row of (data || []) as any[]) {
    const current = typeof row.folder_path === 'string' ? row.folder_path : ''
    if (current !== fromRaw && !current.startsWith(`${fromRaw}/`)) continue
    const next = `${toRaw}${current.slice(fromRaw.length)}`
    if (next.length > 2000) continue
    const { error: updateError } = await admin
      .from('lease_cloud_folders')
      .update({ folder_path: next, updated_at: now })
      .eq('lease_id', row.lease_id)
      .eq('cloud_connection_id', connectionId)
      .eq('user_id', userId)
    if (updateError) console.error(`Ordnerzuordnung nachführen fehlgeschlagen (Code ${updateError.code || '-'})`)
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const respond = (body: unknown, status = 200) => jsonResponse(body, status, corsHeaders)

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Methode nicht erlaubt.')
    const admin = getAdminClient()
    const { user } = await requireUser(req, admin)

    // Anfrage lesen (ein user_id-Feld im Body wird bewusst ignoriert)
    let action = ''
    let path: unknown = ''
    let itemId: unknown = ''
    let folderName: unknown = ''
    let fromPath: unknown = ''
    let toPath: unknown = ''
    let providerParam: unknown = undefined
    let connectionId: unknown = undefined
    let fileToUpload: File | null = null

    const contentType = req.headers.get('content-type') || ''
    try {
      if (contentType.includes('multipart/form-data')) {
        const formData = await req.formData()
        action = String(formData.get('action') || '')
        path = formData.get('path') ?? ''
        providerParam = formData.get('provider') || undefined
        connectionId = formData.get('connectionId') || undefined
        folderName = formData.get('folderName') ?? ''
        const f = formData.get('file')
        fileToUpload = f instanceof File ? f : null
      } else {
        const body = await req.json()
        action = typeof body?.action === 'string' ? body.action : ''
        path = body?.path ?? ''
        itemId = body?.itemId ?? ''
        folderName = body?.folderName ?? ''
        fromPath = body?.fromPath ?? ''
        toPath = body?.toPath ?? ''
        providerParam = body?.provider
        connectionId = body?.connectionId
      }
    } catch {
      throw new HttpError(400, 'invalid_request', 'Ungültige Anfrage.')
    }

    if (!ACTIONS.includes(action)) throw new HttpError(400, 'invalid_action', 'Unbekannte Aktion.')

    // 'move': Pfade vor jedem Anbieter-Aufruf prüfen (Rohform für lease_cloud_folders)
    const rawFrom = action === 'move' ? normalizeRawPath(fromPath) : null
    const rawTo = action === 'move' ? normalizeRawPath(toPath) : null
    if (action === 'move') {
      if (!rawFrom || !rawTo) throw new HttpError(400, 'invalid_path', 'Ungültiger Ordnerpfad.')
      if (rawFrom === rawTo) return respond({ success: true, moved: false })
    }

    // Ältere App-Versionen schicken nur den Anbieter (Standard wie bisher: onedrive)
    const requestedProvider = providerParam || (connectionId ? undefined : 'onedrive')
    const connection = await loadConnection(admin, user.id, connectionId, requestedProvider)
    const provider = connection.provider
    const accessToken = await getValidAccessToken(admin, connection)
    const getToken = () => accessToken

    // ------------------------------------------------------------------ OneDrive
    if (provider === 'onedrive') {
      const graph = makeGraphCall(getToken)

      if (action === 'list') {
        const segments = splitPath(path, true)
        // deno-lint-ignore no-explicit-any
        let data: any = await graph(
          `${oneDrivePath(segments)}:/children?$select=id,name,folder,file,webUrl,size,lastModifiedDateTime,@microsoft.graph.downloadUrl`,
        )
        if (!data) {
          return respond(
            {
              error: `Der Ordnerpfad '/${segments.join('/')}' konnte in OneDrive nicht gefunden werden.`,
              code: 'folder_not_found',
            },
            404,
          )
        }
        // deno-lint-ignore no-explicit-any
        const items: any[] = [...(data.value || [])]
        for (let page = 0; data?.['@odata.nextLink'] && page < 20; page++) {
          data = await graph(data['@odata.nextLink'])
          if (!data) break
          items.push(...(data.value || []))
        }

        // deno-lint-ignore no-explicit-any
        const files = items.map((f: any) => ({
          id: f.id,
          name: f.name,
          isFolder: !!f.folder,
          url: f.webUrl,
          downloadUrl: f['@microsoft.graph.downloadUrl'] || null,
          thumbnailUrl: f['@microsoft.graph.downloadUrl'] || null,
          size: f.size,
          updatedAt: f.lastModifiedDateTime,
        }))
        return respond({ files })
      }

      if (action === 'upload') {
        if (!fileToUpload) throw new HttpError(400, 'missing_file', 'Es wurde keine Datei übermittelt.')
        const segments = splitPath(path, true)
        const safeFileName = cleanSegment(fileToUpload.name || '', true)
        const data = await graph(`${oneDrivePath([...segments, safeFileName])}:/content`, {
          method: 'PUT',
          binary: await fileToUpload.arrayBuffer(),
        })
        return respond({ success: true, file: data })
      }

      if (action === 'get_download_link') {
        // deno-lint-ignore no-explicit-any
        let data: any = null
        if (itemId) {
          const id = validateItemId(itemId)
          data = await graph(
            `/me/drive/items/${encodeURIComponent(id)}?$select=id,webUrl,parentReference,@microsoft.graph.downloadUrl`,
          )
          if (!data) throw new HttpError(404, 'item_not_found', 'Das Element wurde nicht gefunden.')
          if (!isInsideOneDriveAppFolder(data)) {
            throw new HttpError(403, 'outside_app_folder', `Es sind nur Elemente im Ordner ${APP_FOLDER} abrufbar.`)
          }
        } else if (path) {
          const segments = splitPath(path, true)
          data = await graph(`${oneDrivePath(segments)}?$select=id,webUrl,@microsoft.graph.downloadUrl`)
          if (!data) throw new HttpError(404, 'item_not_found', 'Das Element wurde nicht gefunden.')
        } else {
          throw new HttpError(400, 'missing_item', 'Element-ID oder Pfad fehlt.')
        }

        const resolvedId = data?.id ? String(data.id) : ''
        let downloadUrl: string | null = null

        if (resolvedId) {
          // 1. Vorab authentifizierte Vorschau-URL (schnell)
          try {
            const thumbRes = await fetchWithRetry(
              `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(resolvedId)}/thumbnails`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
            )
            if (thumbRes.ok) {
              const thumbData = await thumbRes.json()
              const largeThumb = thumbData?.value?.[0]?.large?.url
              if (largeThumb) downloadUrl = largeThumb
            } else {
              await thumbRes.body?.cancel()
            }
          } catch (err) {
            console.error('OneDrive-Vorschau konnte nicht geladen werden:', err instanceof Error ? err.message : err)
          }
        }

        // 2. Fallback: Download-URL aus den Metadaten
        if (!downloadUrl) downloadUrl = data?.['@microsoft.graph.downloadUrl'] || null

        // 3. Fallback: Weiterleitungsziel von /content
        if (!downloadUrl && resolvedId) {
          try {
            const contentRes = await fetch(
              `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(resolvedId)}/content`,
              { headers: { Authorization: `Bearer ${accessToken}` }, redirect: 'manual' },
            )
            if (contentRes.status === 302 || contentRes.status === 301) {
              downloadUrl = contentRes.headers.get('location')
            }
            await contentRes.body?.cancel()
          } catch (err) {
            console.error('OneDrive-Download-Weiterleitung fehlgeschlagen:', err instanceof Error ? err.message : err)
          }
        }

        return respond({ downloadUrl })
      }

      if (action === 'delete') {
        const id = validateItemId(itemId)
        const item = await graph(`/me/drive/items/${encodeURIComponent(id)}?$select=id,name,parentReference`)
        if (!item) throw new HttpError(404, 'item_not_found', 'Das Element wurde nicht gefunden.')
        if (!isInsideOneDriveAppFolder(item)) {
          throw new HttpError(403, 'outside_app_folder', `Es können nur Elemente im Ordner ${APP_FOLDER} gelöscht werden.`)
        }
        // DELETE verschiebt bei OneDrive in den Papierkorb
        await graph(`/me/drive/items/${encodeURIComponent(id)}`, { method: 'DELETE' })
        return respond({ success: true })
      }

      if (action === 'create_folder') {
        if (typeof folderName !== 'string' || !folderName.trim()) {
          throw new HttpError(400, 'missing_name', 'Der Ordnername fehlt.')
        }
        const safeFolderName = cleanSegment(folderName.trim(), true)
        const segments = splitPath(path, true)
        const parentFolder = await graph(`${oneDrivePath(segments)}?$select=id,folder`)
        if (!parentFolder?.id || !parentFolder.folder) {
          throw new HttpError(404, 'folder_not_found', 'Der übergeordnete Ordner wurde nicht gefunden.')
        }
        const newFolder = await graph(`/me/drive/items/${encodeURIComponent(parentFolder.id)}/children`, {
          method: 'POST',
          json: { name: safeFolderName, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' },
        })
        return respond({ success: true, folder: newFolder })
      }

      if (action === 'move') {
        const from = splitPath(fromPath, true)
        const to = splitPath(toPath, true)
        checkMovePaths(from, to)
        const source = await graph(`${oneDrivePath(from)}?$select=id,name,folder`)
        if (!source?.id) return respond(sourceNotFound, 404)
        if (!source.folder) throw new HttpError(400, 'not_a_folder', 'Es können nur Ordner umbenannt werden.')
        // Gleiche ID = nur andere Groß-/Kleinschreibung desselben Ordners
        const existing = await graph(`${oneDrivePath(to)}?$select=id`)
        if (existing?.id && String(existing.id) !== String(source.id)) {
          throw new HttpError(409, 'target_exists', TARGET_EXISTS_MESSAGE)
        }
        const parent = await graph(`${oneDrivePath(to.slice(0, -1))}?$select=id,folder`)
        if (!parent?.id || !parent.folder) return respond(targetParentNotFound, 404)
        const moved = await graph(`/me/drive/items/${encodeURIComponent(String(source.id))}`, {
          method: 'PATCH',
          json: { name: to[to.length - 1], parentReference: { id: String(parent.id) } },
          conflictOk: true,
        })
        if (moved?.conflict) throw new HttpError(409, 'target_exists', TARGET_EXISTS_MESSAGE)
        if (!moved) return respond(sourceNotFound, 404)
        await updateLeaseFolderPaths(admin, user.id, connection.id, rawFrom as string, rawTo as string)
        return respond({ success: true, moved: true })
      }
    }

    // -------------------------------------------------------------- Google Drive
    if (provider === 'googledrive') {
      const gdrive = makeGoogleCall(getToken)

      let appRootIds: string[] | null = null
      const getAppRootIds = async (): Promise<string[]> => {
        if (appRootIds) return appRootIds
        const search = await gdrive('/files', {
          query: {
            q: `name = '${gq(APP_FOLDER)}' and 'root' in parents and mimeType = '${GOOGLE_FOLDER_MIME}' and trashed = false`,
            fields: 'files(id)',
            pageSize: '10',
          },
        })
        // deno-lint-ignore no-explicit-any
        appRootIds = (search?.files || []).map((f: any) => String(f.id))
        return appRootIds
      }

      // Ordner-ID zu einem Pfad unterhalb des App-Ordners (null = nicht gefunden)
      const getFolderIdByPath = async (segments: string[]): Promise<string | null> => {
        const rootIds = await getAppRootIds()
        if (rootIds.length === 0) return null
        let currentParentId = rootIds[0]
        for (const segment of segments) {
          const search = await gdrive('/files', {
            query: {
              q: `name = '${gq(segment)}' and '${gq(currentParentId)}' in parents and mimeType = '${GOOGLE_FOLDER_MIME}' and trashed = false`,
              fields: 'files(id)',
              pageSize: '10',
            },
          })
          const folder = search?.files?.[0]
          if (!folder) return null
          currentParentId = String(folder.id)
        }
        return currentParentId
      }

      // Liegt das Element innerhalb des App-Ordners? (Elternkette hochlaufen, max. 25 Ebenen)
      const isInsideGoogleAppFolder = async (fileId: string): Promise<boolean> => {
        const rootIds = await getAppRootIds()
        if (rootIds.length === 0 || rootIds.includes(fileId)) return false
        let current = await gdrive(`/files/${encodeURIComponent(fileId)}`, { query: { fields: 'id, parents' } })
        if (!current) throw new HttpError(404, 'item_not_found', 'Das Element wurde nicht gefunden.')
        for (let depth = 0; depth < 25; depth++) {
          const parents: string[] = Array.isArray(current?.parents) ? current.parents : []
          if (parents.some((p) => rootIds.includes(p))) return true
          if (parents.length === 0) return false
          current = await gdrive(`/files/${encodeURIComponent(parents[0])}`, { query: { fields: 'id, parents' } })
          if (!current) return false
        }
        return false
      }

      if (action === 'list') {
        const segments = splitPath(path, false)
        const folderId = await getFolderIdByPath(segments)
        if (!folderId) {
          return respond(
            {
              error: `Der Ordnerpfad '${[APP_FOLDER, ...segments].join('/')}' konnte in Google Drive nicht gefunden werden.`,
              code: 'folder_not_found',
            },
            404,
          )
        }

        // deno-lint-ignore no-explicit-any
        const items: any[] = []
        let pageToken = ''
        for (let page = 0; page < 10; page++) {
          const query: Record<string, string> = {
            q: `'${gq(folderId)}' in parents and trashed = false`,
            fields: `nextPageToken, files(${GOOGLE_FILE_FIELDS})`,
            pageSize: '1000',
          }
          if (pageToken) query.pageToken = pageToken
          const data = await gdrive('/files', { query })
          items.push(...(data?.files || []))
          pageToken = data?.nextPageToken || ''
          if (!pageToken) break
        }

        // deno-lint-ignore no-explicit-any
        const files = items.map((f: any) => ({
          id: f.id,
          name: f.name,
          isFolder: f.mimeType === GOOGLE_FOLDER_MIME,
          url: f.webViewLink,
          downloadUrl: f.webContentLink || null,
          thumbnailUrl: f.thumbnailLink || null,
          size: f.size ? parseInt(f.size) : 0,
          updatedAt: f.modifiedTime,
        }))
        return respond({ files })
      }

      if (action === 'upload') {
        if (!fileToUpload) throw new HttpError(400, 'missing_file', 'Es wurde keine Datei übermittelt.')
        // 1. Zielordner ZUERST auflösen – bei Fehler entsteht keine verwaiste Datei im Drive-Stamm
        const segments = splitPath(path, false)
        const parentId = await getFolderIdByPath(segments)
        if (!parentId) {
          return respond({ error: 'Der Zielordner wurde in Google Drive nicht gefunden.', code: 'folder_not_found' }, 404)
        }
        const fileName = cleanSegment(fileToUpload.name || '', false)
        const mimeType = fileToUpload.type || 'application/octet-stream'

        // 2. Fortsetzbarer Upload mit Metadaten (Name + Ordner) – die Datei entsteht erst beim Abschluss
        const initRes = await fetchWithRetry(
          `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${encodeURIComponent(GOOGLE_FILE_FIELDS)}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json; charset=UTF-8',
              'X-Upload-Content-Type': mimeType,
            },
            body: JSON.stringify({ name: fileName, parents: [parentId] }),
          },
        )
        if (!initRes.ok) throw await providerError(initRes, 'Google-Upload')
        const sessionUrl = initRes.headers.get('location') || ''
        await initRes.body?.cancel()
        let sessionHostOk = false
        try {
          const u = new URL(sessionUrl)
          sessionHostOk = u.protocol === 'https:' && (u.hostname === 'googleapis.com' || u.hostname.endsWith('.googleapis.com'))
        } catch {
          sessionHostOk = false
        }
        if (!sessionHostOk) {
          throw new HttpError(424, 'provider_error', 'Google Drive hat den Upload nicht angenommen.')
        }

        const uploadRes = await fetchWithRetry(sessionUrl, {
          method: 'PUT',
          headers: { 'Content-Type': mimeType },
          body: await fileToUpload.arrayBuffer(),
        })
        if (!uploadRes.ok) throw await providerError(uploadRes, 'Google-Upload')
        const data = await uploadRes.json()
        return respond({ success: true, file: data })
      }

      if (action === 'get_download_link') {
        let fileId: string | null = null
        if (itemId) {
          fileId = validateItemId(itemId)
          if (!(await isInsideGoogleAppFolder(fileId))) {
            throw new HttpError(403, 'outside_app_folder', `Es sind nur Elemente im Ordner ${APP_FOLDER} abrufbar.`)
          }
        } else if (path) {
          fileId = await getFolderIdByPath(splitPath(path, false))
          if (!fileId) throw new HttpError(404, 'item_not_found', 'Das Element wurde nicht gefunden.')
        } else {
          throw new HttpError(400, 'missing_item', 'Element-ID oder Pfad fehlt.')
        }

        const data = await gdrive(`/files/${encodeURIComponent(fileId)}`, {
          query: { fields: 'webContentLink, thumbnailLink' },
        })
        return respond({ downloadUrl: data?.thumbnailLink || data?.webContentLink || null })
      }

      if (action === 'delete') {
        const id = validateItemId(itemId)
        if (!(await isInsideGoogleAppFolder(id))) {
          throw new HttpError(403, 'outside_app_folder', `Es können nur Elemente im Ordner ${APP_FOLDER} gelöscht werden.`)
        }
        // In den Papierkorb verschieben (files.delete würde endgültig löschen)
        const result = await gdrive(`/files/${encodeURIComponent(id)}`, { method: 'PATCH', json: { trashed: true } })
        if (!result) throw new HttpError(404, 'item_not_found', 'Das Element wurde nicht gefunden.')
        return respond({ success: true })
      }

      if (action === 'create_folder') {
        if (typeof folderName !== 'string' || !folderName.trim()) {
          throw new HttpError(400, 'missing_name', 'Der Ordnername fehlt.')
        }
        const safeFolderName = cleanSegment(folderName.trim(), false)
        const parentId = await getFolderIdByPath(splitPath(path, false))
        if (!parentId) throw new HttpError(404, 'folder_not_found', 'Der übergeordnete Ordner wurde nicht gefunden.')

        const newFolder = await gdrive('/files', {
          method: 'POST',
          json: { name: safeFolderName, mimeType: GOOGLE_FOLDER_MIME, parents: [parentId] },
        })
        return respond({ success: true, folder: newFolder })
      }

      if (action === 'move') {
        const from = splitPath(fromPath, false)
        const to = splitPath(toPath, false)
        checkMovePaths(from, to)
        const sourceId = await getFolderIdByPath(from)
        if (!sourceId) return respond(sourceNotFound, 404)
        // Google erlaubt doppelte Namen – trotzdem nie zwei gleichnamige Ordner erzeugen
        const existingId = await getFolderIdByPath(to)
        if (existingId && existingId !== sourceId) throw new HttpError(409, 'target_exists', TARGET_EXISTS_MESSAGE)
        const parentId = await getFolderIdByPath(to.slice(0, -1))
        if (!parentId) return respond(targetParentNotFound, 404)
        const meta = await gdrive(`/files/${encodeURIComponent(sourceId)}`, { query: { fields: 'id, parents' } })
        if (!meta) return respond(sourceNotFound, 404)
        const parents: string[] = Array.isArray(meta.parents) ? meta.parents.map((p: unknown) => String(p)) : []
        const query: Record<string, string> = { fields: 'id, name, parents' }
        if (!parents.includes(parentId)) {
          query.addParents = parentId
          if (parents.length > 0) query.removeParents = parents.join(',')
        }
        const updated = await gdrive(`/files/${encodeURIComponent(sourceId)}`, {
          method: 'PATCH',
          json: { name: to[to.length - 1] },
          query,
        })
        if (!updated) return respond(sourceNotFound, 404)
        await updateLeaseFolderPaths(admin, user.id, connection.id, rawFrom as string, rawTo as string)
        return respond({ success: true, moved: true })
      }
    }

    throw new HttpError(400, 'unsupported', 'Aktion oder Cloud-Anbieter wird nicht unterstützt.')
  } catch (error) {
    return errorResponse(error, corsHeaders, 'cloud-drive')
  }
})
