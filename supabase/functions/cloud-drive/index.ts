// cloud-drive: Datei-Proxy zu Microsoft OneDrive / Google Drive
// Aktionen: list, upload, get_download_link, delete, create_folder
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

// ---------------------------------------------------------------------------
// Gemeinsamer Block B – identisch in cloud-drive und cloud-sync
// (Verbindung laden, Token erneuern, Anbieter-Aufrufe mit Drosselungs-Behandlung)
// ---------------------------------------------------------------------------

const APP_FOLDER = 'ImmoControlpro360'
const INVALID_ONEDRIVE_CHARS = /["*:<>?\/\\|]/g
// deno-lint-ignore no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const CONNECTION_COLUMNS = 'id, user_id, provider, account_email, access_token, refresh_token, expires_at, created_at'
const RECONNECT_MESSAGE =
  'Die Cloud-Verbindung ist abgelaufen oder wurde widerrufen. Bitte verbinden Sie das Konto unter Einstellungen > Cloud neu.'

const TOKEN_ENDPOINTS: Record<string, string> = {
  onedrive: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  googledrive: 'https://oauth2.googleapis.com/token',
}

// Escaping für Google-Drive-Suchausdrücke (q): erst Backslash, dann Hochkomma
const gq = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

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

// Liefert ein gültiges Access-Token; erneuert es bei Bedarf und speichert es per service_role.
// deno-lint-ignore no-explicit-any
const getValidAccessToken = async (admin: any, connection: any): Promise<string> => {
  const expiresAtMs = connection.expires_at ? Date.parse(connection.expires_at) : NaN
  if (connection.access_token && Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > 5 * 60 * 1000) {
    return connection.access_token
  }
  if (!connection.refresh_token) throw new HttpError(409, 'reconnect_required', RECONNECT_MESSAGE)

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
        refresh_token: connection.refresh_token,
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
  const newExpiresAt = new Date(Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000)
  const update: Record<string, string> = {
    access_token: tokenResponse.access_token,
    expires_at: newExpiresAt.toISOString(),
  }
  if (tokenResponse.refresh_token) update.refresh_token = tokenResponse.refresh_token

  const { error: updateError } = await admin
    .from('cloud_connections')
    .update(update)
    .eq('id', connection.id)
    .eq('user_id', connection.user_id)
  if (updateError) console.error(`Token-Update fehlgeschlagen (Verbindung ${connection.id}):`, updateError.message)

  connection.access_token = update.access_token
  connection.expires_at = update.expires_at
  if (update.refresh_token) connection.refresh_token = update.refresh_token
  return update.access_token
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

const ACTIONS = ['list', 'upload', 'get_download_link', 'delete', 'create_folder']
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
        providerParam = body?.provider
        connectionId = body?.connectionId
      }
    } catch {
      throw new HttpError(400, 'invalid_request', 'Ungültige Anfrage.')
    }

    if (!ACTIONS.includes(action)) throw new HttpError(400, 'invalid_action', 'Unbekannte Aktion.')

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
    }

    throw new HttpError(400, 'unsupported', 'Aktion oder Cloud-Anbieter wird nicht unterstützt.')
  } catch (error) {
    return errorResponse(error, corsHeaders, 'cloud-drive')
  }
})
