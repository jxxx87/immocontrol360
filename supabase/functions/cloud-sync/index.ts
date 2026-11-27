// cloud-sync: legt die Ordnerstruktur der Objekte in OneDrive / Google Drive an ('create')
// bzw. meldet fehlende Ordner ('check').
//
// Komplett-Check 2026-11-27, Paket CLOUD:
// - Nutzer nur aus dem Authorization-Header (Vertrag C2, getUser mit Service-Client);
//   role=anon zählt nicht als angemeldet, user_id im Body wird ignoriert.
// - Objekte/Einheiten/Mietverhältnisse werden mit dem Nutzer-JWT gelesen (RLS = nur Objekte, auf die
//   der Nutzer Zugriff hat); eine übergebene propertyId ohne Zugriff ergibt 404.
// - Verbindung: connectionId > Portfolio-Zuweisung (portfolio_cloud_links) > älteste Verbindung des
//   Anbieters; nur eigene Verbindungen, Tokens per service_role, nie an den Browser.
// - Altordner (Mietverträge, Schriftverkehr, <Einheit> direkt im Objektordner) werden NUR entfernt,
//   wenn sie leer sind (Papierkorb); Ordner mit Inhalt bleiben stehen. Strukturordner werden nie
//   angefasst. Vorhandene Elemente werden beim Anlegen nie ersetzt (conflictBehavior 'fail').
// - foldersToCreate wird auf die berechneten Soll-Pfade beschränkt; Logs nur mit Anzahlen.
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

const DEFAULT_SUBFOLDERS = [
  'Rechnungen',
  'Bilder',
  'Nebenkosten',
  'Versicherungen',
  'Energieausweise',
  'Neuvermietung',
]

// Alte Ordnerstruktur direkt im Objektordner (wird nur entfernt, wenn leer)
const LEGACY_FOLDERS = ['Mietverträge', 'Schriftverkehr']
// Diese Namen gehören zur aktuellen Struktur und werden nie als Altordner behandelt
const PROTECTED_FOLDER_NAMES = new Set(
  [...DEFAULT_SUBFOLDERS, 'Einheiten', 'Mietverhältnisse'].map((n) => n.toLowerCase()),
)
const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'
const GOOGLE_FULL_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

// Pfad in Segmente zerlegen; null = enthält ein ungültiges Segment (Pfad wird übersprungen)
const toSegments = (path: string, stripOneDriveChars: boolean): string[] | null => {
  if (typeof path !== 'string') return null
  const out: string[] = []
  for (const raw of path.split('/')) {
    if (raw.length === 0) continue
    const s = stripOneDriveChars ? raw.replace(INVALID_ONEDRIVE_CHARS, '') : raw
    if (!s || s === '.' || s === '..' || s.length > 255 || CONTROL_CHARS.test(s)) return null
    out.push(s)
  }
  return out.length > 0 ? out : null
}

// Parallelität begrenzen (Schutz vor Drosselung durch den Anbieter)
const mapLimit = async <T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> => {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
}

// Nur bei vollem Drive-Zugriff ist eine Leer-Prüfung verlässlich (mit drive.file sieht die App
// nur selbst angelegte Dateien – ein Ordner könnte leer wirken, obwohl er Dateien enthält).
const googleHasFullDriveScope = async (accessToken: string): Promise<boolean> => {
  try {
    // Dokumentierte Schnittstelle: access_token als Parameter (hier im POST-Body, nicht in der URL)
    const res = await fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Authorization: `Bearer ${accessToken}`,
      },
      body: new URLSearchParams({ access_token: accessToken }),
    })
    if (!res.ok) {
      await res.body?.cancel()
      return false
    }
    const info = await res.json()
    return typeof info?.scope === 'string' && info.scope.split(' ').includes(GOOGLE_FULL_DRIVE_SCOPE)
  } catch {
    return false
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const respond = (body: unknown, status = 200) => jsonResponse(body, status, corsHeaders)
  const dbError = (label: string, error: { message?: string }) => {
    console.error(`[cloud-sync] ${label}:`, error?.message)
    return new HttpError(500, 'db_error', 'Die Daten für den Cloud-Abgleich konnten nicht geladen werden.')
  }

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Methode nicht erlaubt.')
    const admin = getAdminClient()
    const { user, jwt } = await requireUser(req, admin)

    // deno-lint-ignore no-explicit-any
    let body: any
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'invalid_request', 'Ungültige Anfrage.')
    }

    const action = body?.action
    if (action !== 'check' && action !== 'create') throw new HttpError(400, 'invalid_action', 'Unbekannte Aktion.')

    const rawPropertyId = body?.propertyId
    if (rawPropertyId !== undefined && rawPropertyId !== null && rawPropertyId !== '' && !isUuid(rawPropertyId)) {
      throw new HttpError(400, 'invalid_property', 'Ungültige Objekt-ID.')
    }
    const propertyId = isUuid(rawPropertyId) ? rawPropertyId : null
    const requestedProvider = typeof body?.provider === 'string' ? body.provider : undefined
    const rawConnectionId = body?.connectionId
    if (rawConnectionId !== undefined && rawConnectionId !== null && rawConnectionId !== '' && !isUuid(rawConnectionId)) {
      throw new HttpError(400, 'invalid_connection', 'Ungültige Verbindungs-ID.')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    if (!supabaseUrl || !anonKey) throw new HttpError(500, 'server_config', 'Server-Konfiguration unvollständig.')
    // Nutzer-Client: Objekte, Einheiten und Mietverhältnisse nur im Rahmen der RLS-Rechte des Nutzers
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // 1. Objekte laden (propertyId darf auch eine economic_unit_id sein)
    const PROP_COLUMNS = 'id, street, house_number, city, economic_unit_id, portfolio_id'
    // deno-lint-ignore no-explicit-any
    let props: any[] = []
    if (propertyId) {
      const { data: groupProps, error: groupError } = await userClient
        .from('properties')
        .select(PROP_COLUMNS)
        .eq('economic_unit_id', propertyId)
        .order('street')
      if (groupError) throw dbError('Objekte der Wirtschaftseinheit laden', groupError)

      if (groupProps && groupProps.length > 0) {
        props = groupProps
      } else {
        const { data: targetProp, error: targetError } = await userClient
          .from('properties')
          .select(PROP_COLUMNS)
          .eq('id', propertyId)
          .maybeSingle()
        if (targetError) throw dbError('Objekt laden', targetError)
        if (!targetProp) {
          throw new HttpError(404, 'property_not_found', 'Das Objekt wurde nicht gefunden oder Sie haben keinen Zugriff darauf.')
        }
        if (targetProp.economic_unit_id) {
          const { data: members, error: membersError } = await userClient
            .from('properties')
            .select(PROP_COLUMNS)
            .eq('economic_unit_id', targetProp.economic_unit_id)
            .order('street')
          if (membersError) throw dbError('Objekte der Wirtschaftseinheit laden', membersError)
          props = members && members.length > 0 ? members : [targetProp]
        } else {
          props = [targetProp]
        }
      }
    } else {
      const { data, error } = await userClient.from('properties').select(PROP_COLUMNS).order('street')
      if (error) throw dbError('Objekte laden', error)
      props = data || []
    }

    // 2. Verbindung bestimmen – ausschließlich unter den eigenen Verbindungen des Nutzers
    const { data: ownConnections, error: ownConnError } = await admin
      .from('cloud_connections')
      .select('id, provider, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    if (ownConnError) throw dbError('Cloud-Verbindungen laden', ownConnError)
    if (!ownConnections || ownConnections.length === 0) {
      throw new HttpError(404, 'no_connection', 'Keine aktive Cloud-Verbindung gefunden.')
    }
    const { data: links, error: linksError } = await admin
      .from('portfolio_cloud_links')
      .select('portfolio_id, cloud_connection_id')
      .eq('user_id', user.id)
    if (linksError) throw dbError('Portfolio-Zuweisungen laden', linksError)

    // deno-lint-ignore no-explicit-any
    const ownIds = new Set(ownConnections.map((c: any) => c.id))
    const linkByPortfolio: Record<string, string> = {}
    // deno-lint-ignore no-explicit-any
    ;(links || []).forEach((l: any) => {
      if (ownIds.has(l.cloud_connection_id)) linkByPortfolio[l.portfolio_id] = l.cloud_connection_id
    })
    // Wirksame Cloud eines Portfolios: die Zuweisung, sonst (nur bei genau einer Verbindung) diese
    const effectiveConnectionId = (portfolioId: string): string | null =>
      linkByPortfolio[portfolioId] || (ownConnections.length === 1 ? ownConnections[0].id : null)

    let connectionIdToUse: string | null = isUuid(rawConnectionId) ? rawConnectionId : null
    if (!connectionIdToUse && propertyId && props.length > 0) {
      const linkedId = linkByPortfolio[props[0].portfolio_id]
      if (linkedId) {
        // deno-lint-ignore no-explicit-any
        const linked = ownConnections.find((c: any) => c.id === linkedId)
        if (requestedProvider && linked && linked.provider !== requestedProvider) {
          // Das Portfolio ist ausdrücklich einer anderen Cloud zugewiesen -> hier nichts anlegen
          return respond(action === 'check' ? { missingFolders: [], skipped: true } : { success: true, skipped: true })
        }
        connectionIdToUse = linkedId
      }
    }

    const connection = await loadConnection(admin, user.id, connectionIdToUse, requestedProvider)
    const provider = connection.provider

    // Ohne propertyId: nur Objekte, deren Portfolio in genau diese Cloud gehört
    if (!propertyId) props = props.filter((p) => effectiveConnectionId(p.portfolio_id) === connection.id)

    if (props.length === 0) {
      return respond(action === 'check' ? { missingFolders: [] } : { success: true })
    }

    // 3. Einheiten und Mietverhältnisse (mit Mieternamen) laden
    const propIds = props.map((p) => p.id)
    const { data: unitsData, error: unitsError } = await userClient
      .from('units')
      .select('id, property_id, unit_name')
      .in('property_id', propIds)
    if (unitsError) throw dbError('Einheiten laden', unitsError)
    // deno-lint-ignore no-explicit-any
    const units: any[] = unitsData || []

    // deno-lint-ignore no-explicit-any
    let leases: any[] = []
    if (units.length > 0) {
      const { data: leasesData, error: leasesError } = await userClient
        .from('leases')
        .select('id, unit_id, status, tenant:tenants(first_name, last_name)')
        .in('unit_id', units.map((u) => u.id))
      if (leasesError) console.error('[cloud-sync] Mietverhältnisse laden fehlgeschlagen:', leasesError.message)
      leases = leasesData || []
    }

    // Nur Anzahlen loggen – keine Namen/Adressen in den Function-Logs
    console.log(
      `[cloud-sync] ${action} (${provider}): ${props.length} Objekte, ${units.length} Einheiten, ${leases.length} Mietverhältnisse`,
    )

    // 4. Objekte gruppieren und Ordnernamen bilden (unverändert, damit bestehende Ordner passen)
    // deno-lint-ignore no-explicit-any
    const groups: Record<string, any> = {}
    // deno-lint-ignore no-explicit-any
    const ungrouped: any[] = []

    props.forEach((p) => {
      if (p.economic_unit_id) {
        if (!groups[p.economic_unit_id]) {
          groups[p.economic_unit_id] = {
            id: p.economic_unit_id,
            isGroup: true,
            members: [],
          }
        }
        groups[p.economic_unit_id].members.push(p)
      } else {
        ungrouped.push({ ...p, isGroup: false })
      }
    })

    // deno-lint-ignore no-explicit-any
    const finalGrouped: any[] = [...Object.values(groups), ...ungrouped]

    finalGrouped.forEach((item) => {
      if (item.isGroup) {
        const groupedByStreet: Record<string, string[]> = {}
        // deno-lint-ignore no-explicit-any
        item.members.forEach((m: any) => {
          if (!m.street) return
          if (!groupedByStreet[m.street]) groupedByStreet[m.street] = []
          if (m.house_number) {
            groupedByStreet[m.street].push(m.house_number)
          }
        })
        const parts = Object.keys(groupedByStreet).map((street) => {
          const nums = groupedByStreet[street]
          if (nums.length > 0) {
            return `${street} ${nums.join(' & ')}`
          }
          return street
        })
        const displayNames = parts.slice(0, 2).join(' | ')
        const groupName = parts.length > 2 ? `${displayNames} u.a.` : displayNames
        item.displayFolderName = `WG: ${groupName || 'Wirtschaftsgemeinschaft'}`
      } else {
        item.displayFolderName = `${item.street} ${item.house_number || ''}`.trim()
      }
    })

    // deno-lint-ignore no-explicit-any
    const relatedUnitsOf = (item: any) => {
      // deno-lint-ignore no-explicit-any
      const propertyIds = item.isGroup ? item.members.map((m: any) => m.id) : [item.id]
      return units.filter((u) => propertyIds.includes(u.property_id))
    }

    // 5. Soll-Pfade berechnen
    const expectedPaths: string[] = []

    finalGrouped.forEach((item) => {
      const folderName = item.displayFolderName

      DEFAULT_SUBFOLDERS.forEach((sub) => {
        expectedPaths.push(`${folderName}/${sub}`)
      })

      relatedUnitsOf(item).forEach((unit) => {
        if (unit.unit_name) {
          let unitFolderPath = ''
          if (item.isGroup) {
            // deno-lint-ignore no-explicit-any
            const prop = item.members.find((m: any) => m.id === unit.property_id)
            const houseNumber = prop?.house_number || 'Ohne Hausnummer'
            unitFolderPath = `${folderName}/Einheiten/${houseNumber}/${unit.unit_name}`
          } else {
            unitFolderPath = `${folderName}/Einheiten/${unit.unit_name}`
          }

          expectedPaths.push(`${unitFolderPath}/Bilder`)
          expectedPaths.push(`${unitFolderPath}/Mietverhältnisse`)

          leases
            .filter((l) => l.unit_id === unit.id)
            .forEach((lease) => {
              const tenantName = `${lease.tenant?.first_name || ''} ${lease.tenant?.last_name || ''}`.trim()
              if (tenantName) {
                expectedPaths.push(`${unitFolderPath}/Mietverhältnisse/${tenantName}`)
              }
            })
        }
      })
    })

    // Kandidaten für Altordner direkt im Objektordner (Mietverträge, Schriftverkehr, <Einheit>)
    // deno-lint-ignore no-explicit-any
    const legacyCandidatesOf = (item: any): string[] => {
      const names = new Set<string>(LEGACY_FOLDERS)
      relatedUnitsOf(item).forEach((u) => {
        if (typeof u.unit_name === 'string' && u.unit_name && !u.unit_name.includes('/')) names.add(u.unit_name)
      })
      return [...names]
    }

    // foldersToCreate (vom Client) nur als Auswahl aus den Soll-Pfaden zulassen
    let pathsToCreate = expectedPaths
    if (action === 'create' && body?.foldersToCreate !== undefined && body?.foldersToCreate !== null) {
      if (!Array.isArray(body.foldersToCreate)) {
        throw new HttpError(400, 'invalid_folders', 'Ungültige Ordnerliste.')
      }
      const requested = new Set(body.foldersToCreate.filter((p: unknown) => typeof p === 'string'))
      pathsToCreate = expectedPaths.filter((p) => requested.has(p))
    }

    const accessToken = await getValidAccessToken(admin, connection)
    const getToken = () => accessToken

    // ------------------------------------------------------------------ OneDrive
    if (provider === 'onedrive') {
      const graph = makeGraphCall(getToken)
      const odPath = (segments: string[]) =>
        `/me/drive/root:/${[APP_FOLDER, ...segments].map((s) => encodeURIComponent(s)).join('/')}`
      const folderIdCache = new Map<string, string>()

      const ensureAppRoot = async (): Promise<string> => {
        const cached = folderIdCache.get('')
        if (cached) return cached
        let root = await graph(`${odPath([])}?$select=id,folder`)
        if (!root) {
          // 'fail' statt 'rename': bei parallelen Aufrufen kein zweiter Ordner "ImmoControlpro360 1"
          const created = await graph('/me/drive/root/children', {
            method: 'POST',
            json: { name: APP_FOLDER, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
            conflictOk: true,
          })
          root = created?.conflict ? await graph(`${odPath([])}?$select=id,folder`) : created
        }
        if (!root?.id || !root.folder) {
          throw new HttpError(424, 'folder_create_failed', `Der Ordner ${APP_FOLDER} konnte in OneDrive nicht angelegt werden.`)
        }
        folderIdCache.set('', String(root.id))
        return String(root.id)
      }

      const ensurePath = async (segments: string[]): Promise<string> => {
        let parentId = await ensureAppRoot()
        for (let i = 0; i < segments.length; i++) {
          const current = segments.slice(0, i + 1)
          const key = current.join('/').toLowerCase()
          const cached = folderIdCache.get(key)
          if (cached) {
            parentId = cached
            continue
          }
          let folder = await graph(`${odPath(current)}?$select=id,name,folder`)
          if (!folder) {
            // 'fail' statt 'replace': ein vorhandenes Element wird nie ersetzt
            const created = await graph(`/me/drive/items/${encodeURIComponent(parentId)}/children`, {
              method: 'POST',
              json: { name: segments[i], folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
              conflictOk: true,
            })
            folder = created?.conflict ? await graph(`${odPath(current)}?$select=id,name,folder`) : created
          }
          if (!folder?.id) throw new HttpError(424, 'folder_create_failed', 'Ein Cloud-Ordner konnte nicht angelegt werden.')
          if (!folder.folder) {
            throw new HttpError(
              409,
              'name_conflict',
              `In der Cloud existiert bereits eine Datei mit dem Namen „${segments[i]}". Bitte benennen Sie sie um.`,
            )
          }
          folderIdCache.set(key, String(folder.id))
          parentId = String(folder.id)
        }
        return parentId
      }

      if (action === 'check') {
        const missing = new Set<string>()
        await mapLimit(expectedPaths, 4, async (path) => {
          const segments = toSegments(path, true)
          if (!segments) return // ungültige Namen können ohnehin nicht angelegt werden
          const folder = await graph(`${odPath(segments)}?$select=id`)
          if (!folder) missing.add(path)
        })
        return respond({ missingFolders: expectedPaths.filter((p) => missing.has(p)) })
      }

      // Aktion 'create': leere Altordner entfernen (Papierkorb), Ordner mit Inhalt stehen lassen
      let removedLegacy = 0
      for (const item of finalGrouped) {
        const propSegments = toSegments(item.displayFolderName, true)
        if (!propSegments) continue
        for (const name of legacyCandidatesOf(item)) {
          const seg = toSegments(name, true)
          if (!seg || seg.length !== 1 || PROTECTED_FOLDER_NAMES.has(seg[0].toLowerCase())) continue
          try {
            const folder = await graph(`${odPath([...propSegments, seg[0]])}?$select=id,folder`)
            if (folder?.id && folder.folder && folder.folder.childCount === 0) {
              await graph(`/me/drive/items/${encodeURIComponent(folder.id)}`, { method: 'DELETE' })
              removedLegacy++
            }
          } catch (e) {
            if (e instanceof HttpError && e.code === 'reconnect_required') throw e
            console.error('[cloud-sync] Altordner-Prüfung (OneDrive) fehlgeschlagen:', e instanceof Error ? e.message : e)
          }
        }
      }

      let skipped = 0
      for (const path of pathsToCreate) {
        const segments = toSegments(path, true)
        if (!segments) {
          skipped++
          continue
        }
        await ensurePath(segments)
      }
      console.log(
        `[cloud-sync] OneDrive: ${pathsToCreate.length - skipped} Pfade sichergestellt, ${skipped} ungültig übersprungen, ${removedLegacy} leere Altordner entfernt`,
      )

      return respond({ success: true })
    }

    // -------------------------------------------------------------- Google Drive
    if (provider === 'googledrive') {
      const gdrive = makeGoogleCall(getToken)

      // deno-lint-ignore no-explicit-any
      const findChildFolder = async (parentId: string, name: string): Promise<any> => {
        const search = await gdrive('/files', {
          query: {
            q: `name = '${gq(name)}' and '${gq(parentId)}' in parents and mimeType = '${GOOGLE_FOLDER_MIME}' and trashed = false`,
            fields: 'files(id, name)',
            pageSize: '10',
          },
        })
        return search?.files?.[0] || null
      }

      let rootIdCache: string | null = null
      const getOrCreateRoot = async (): Promise<string> => {
        if (rootIdCache) return rootIdCache
        let root = await findChildFolder('root', APP_FOLDER)
        if (!root) {
          root = await gdrive('/files', {
            method: 'POST',
            json: { name: APP_FOLDER, mimeType: GOOGLE_FOLDER_MIME, parents: ['root'] },
          })
        }
        if (!root?.id) {
          throw new HttpError(424, 'folder_create_failed', `Der Ordner ${APP_FOLDER} konnte in Google Drive nicht angelegt werden.`)
        }
        rootIdCache = String(root.id)
        return rootIdCache
      }

      const folderIdCache = new Map<string, string>()
      const ensurePath = async (segments: string[]): Promise<string> => {
        let parentId = await getOrCreateRoot()
        for (const segment of segments) {
          const key = `${parentId}:${segment}`
          const cached = folderIdCache.get(key)
          if (cached) {
            parentId = cached
            continue
          }
          let folder = await findChildFolder(parentId, segment)
          if (!folder) {
            folder = await gdrive('/files', {
              method: 'POST',
              json: { name: segment, mimeType: GOOGLE_FOLDER_MIME, parents: [parentId] },
            })
          }
          if (!folder?.id) throw new HttpError(424, 'folder_create_failed', 'Ein Cloud-Ordner konnte nicht angelegt werden.')
          folderIdCache.set(key, String(folder.id))
          parentId = String(folder.id)
        }
        return parentId
      }

      if (action === 'check') {
        const rootFolder = await findChildFolder('root', APP_FOLDER)
        if (!rootFolder) {
          return respond({ missingFolders: expectedPaths.filter((p) => toSegments(p, false) !== null) })
        }

        const checkCache = new Map<string, string | null>()
        const pathExists = async (segments: string[]): Promise<boolean> => {
          let parentId = String(rootFolder.id)
          for (const segment of segments) {
            const key = `${parentId}:${segment}`
            if (checkCache.has(key)) {
              const cachedId = checkCache.get(key)
              if (!cachedId) return false
              parentId = cachedId
              continue
            }
            const folder = await findChildFolder(parentId, segment)
            checkCache.set(key, folder ? String(folder.id) : null)
            if (!folder) return false
            parentId = String(folder.id)
          }
          return true
        }

        const missingPaths: string[] = []
        for (const path of expectedPaths) {
          const segments = toSegments(path, false)
          if (!segments) continue
          if (!(await pathExists(segments))) missingPaths.push(path)
        }
        return respond({ missingFolders: missingPaths })
      }

      // Aktion 'create': leere Altordner in den Papierkorb – nur bei vollem Drive-Zugriff,
      // weil nur dann "leer" verlässlich festgestellt werden kann. Ordner mit Inhalt bleiben stehen.
      let removedLegacy = 0
      if (await googleHasFullDriveScope(accessToken)) {
        const rootFolder = await findChildFolder('root', APP_FOLDER)
        if (rootFolder) {
          for (const item of finalGrouped) {
            const propSegments = toSegments(item.displayFolderName, false)
            if (!propSegments) continue
            try {
              let propFolderId: string | null = String(rootFolder.id)
              for (const s of propSegments) {
                const f = await findChildFolder(propFolderId as string, s)
                propFolderId = f ? String(f.id) : null
                if (!propFolderId) break
              }
              if (!propFolderId) continue

              for (const name of legacyCandidatesOf(item)) {
                const seg = toSegments(name, false)
                if (!seg || seg.length !== 1 || PROTECTED_FOLDER_NAMES.has(seg[0].toLowerCase())) continue
                const folder = await findChildFolder(propFolderId, seg[0])
                if (!folder) continue
                const children = await gdrive('/files', {
                  query: { q: `'${gq(String(folder.id))}' in parents and trashed = false`, fields: 'files(id)', pageSize: '1' },
                })
                if (children && Array.isArray(children.files) && children.files.length === 0) {
                  await gdrive(`/files/${encodeURIComponent(String(folder.id))}`, { method: 'PATCH', json: { trashed: true } })
                  removedLegacy++
                }
              }
            } catch (e) {
              if (e instanceof HttpError && e.code === 'reconnect_required') throw e
              console.error('[cloud-sync] Altordner-Prüfung (Google) fehlgeschlagen:', e instanceof Error ? e.message : e)
            }
          }
        }
      }

      let skipped = 0
      for (const path of pathsToCreate) {
        const segments = toSegments(path, false)
        if (!segments) {
          skipped++
          continue
        }
        await ensurePath(segments)
      }
      console.log(
        `[cloud-sync] Google Drive: ${pathsToCreate.length - skipped} Pfade sichergestellt, ${skipped} ungültig übersprungen, ${removedLegacy} leere Altordner entfernt`,
      )

      return respond({ success: true })
    }

    throw new HttpError(400, 'unsupported', 'Cloud-Anbieter wird nicht unterstützt.')
  } catch (error) {
    return errorResponse(error, corsHeaders, 'cloud-sync')
  }
})
