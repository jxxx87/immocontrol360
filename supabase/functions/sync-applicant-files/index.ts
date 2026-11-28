import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

// ─────────────────────────────────────────────────────────────────────────────
// sync-applicant-files
//
// Überträgt die Bewerberunterlagen aus dem Bucket "applicant-documents" in die
// Cloud (OneDrive / Google Drive) des Vermieters und löscht sie danach aus dem Bucket.
//
// Zugriff (Komplett-Check 2026-11-27):
//  • Öffentlich (Vertrag C1): Body { process_token, applicant_id }. Der Bewerber muss
//    zu diesem Prozess gehören, der Prozess muss öffentlich laufen (in_vermietung) und
//    die Bewerbung muss frisch sein (direkt nach dem Absenden).
//  • Angemeldeter Vermieter (Vertrag C2): Eigentümer des Prozesses darf die
//    Übertragung jederzeit erneut anstoßen (z. B. nach Verbinden einer Cloud).
//  • Eine Datei wird nur gelöscht, wenn der Upload nachweislich geklappt hat.
//    Was nicht übertragen werden kann, bleibt im Bucket (Hinweis in der Antwort).
//
// Wave 3 (2026-11-27), Paket 08 CLOUD:
//  • E1-09: Ziel-Cloud wie im Cloud Explorer/cloud-sync: Zuweisung des Portfolios
//    (portfolio_cloud_links), sonst nur die einzige Verbindung des Vermieters. Mehrere
//    Verbindungen ohne Zuweisung -> Unterlagen bleiben vorerst im Speicher (statt in einer
//    womöglich falschen Cloud zu landen).
//  • M2-06: Tokens über cloud_get_tokens/cloud_store_tokens (Vault); Rückfall auf die alten
//    Spalten, solange die Migration fehlt.
//  • G18-12: '/' und '\' in Straße/Hausnummer/Einheit werden wie in cloud-sync zu '-'.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BUCKET = 'applicant-documents'
const APP_FOLDER_NAME = "ImmoControlpro360"
const PUBLIC_SYNC_WINDOW_MS = 60 * 60 * 1000
const MAX_FILES = 10
const MAX_FILE_BYTES = 20 * 1024 * 1024
const ALLOWED_EXTENSIONS: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
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

const isRecent = (timestamp: unknown, windowMs: number): boolean => {
  const t = Date.parse(String(timestamp ?? ''))
  if (Number.isNaN(t)) return false
  const diff = Date.now() - t
  return diff <= windowMs && diff > -5 * 60 * 1000
}

// ── Pfad-Bereinigung (E1-03 / E1-06) ────────────────────────────────────────
// Ein Segment darf nie '/', '\', '..', Steuerzeichen o. ä. enthalten. Für OneDrive
// werden dieselben Zeichen entfernt wie in cloud-sync, damit der Bewerberordner im
// selben Objektordner landet (z. B. "WG: A | B" -> "WG A  B").
const ONEDRIVE_INVALID = /["*:<>?\/\\|]/g
function cleanSegment(raw: unknown, fallback: string, provider: string): string {
  let s = String(raw ?? '').normalize('NFC')
  s = s.replace(/[\u0000-\u001f\u007f]/g, '')
  s = provider === 'onedrive' ? s.replace(ONEDRIVE_INVALID, '') : s.replace(/[\/\\]/g, '_')
  s = s.trim()
  if (s.length > 120) s = s.slice(0, 120).trim()
  // '.', '..' und reine Punktfolgen wären Pfad-Navigation -> nie als Ordnername verwenden
  if (!s || /^\.+$/.test(s)) return fallback
  return s
}

function cleanFileName(raw: string, provider: string): string {
  const base = cleanSegment(raw, 'Dokument', provider)
  return base.replace(/^\.+/, '') || 'Dokument'
}

const fileExtension = (name: string): string => {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : ''
}

// Google-Drive-Suchausdruck: Backslash und Hochkomma escapen
const gq = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

// Ein Name ergibt genau EIN Ordnersegment – dieselbe Regel wie folderSegment in cloud-sync,
// damit der Bewerberordner im selben Objekt-/Einheitenordner landet.
const cloudFolderSegment = (value: unknown): string => String(value ?? '').replace(/[/\\]/g, '-')

// ── OAuth-Tokens (Wave 3, M2-06) ─────────────────────────────────────────────
// Verschlüsselt im Supabase Vault, nur über die RPCs cloud_get_tokens / cloud_store_tokens
// (nur service_role). Solange die Migration fehlt, gelten die bisherigen Spalten.
const isMissingRpc = (error: any): boolean => error?.code === 'PGRST202' || error?.code === '42883'

async function readCloudTokens(supabaseAdmin: any, connectionId: string, userId: string) {
  const { data, error } = await supabaseAdmin.rpc('cloud_get_tokens', { p_connection_id: connectionId, p_user_id: userId })
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data
    return { accessToken: (row?.access_token || null) as string | null, refreshToken: (row?.refresh_token || null) as string | null }
  }
  if (!isMissingRpc(error)) {
    console.error(`Cloud tokens not readable (code ${error.code || '-'})`)
    return null
  }
  const { data: legacy, error: legacyError } = await supabaseAdmin
    .from('cloud_connections')
    .select('access_token, refresh_token')
    .eq('id', connectionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (legacyError) {
    console.error(`Cloud tokens not readable (code ${legacyError.code || '-'})`)
    return null
  }
  return { accessToken: (legacy?.access_token || null) as string | null, refreshToken: (legacy?.refresh_token || null) as string | null }
}

async function storeCloudTokens(
  supabaseAdmin: any,
  connectionId: string,
  userId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: string,
): Promise<boolean> {
  const { error } = await supabaseAdmin.rpc('cloud_store_tokens', {
    p_connection_id: connectionId,
    p_user_id: userId,
    p_access_token: accessToken,
    p_refresh_token: refreshToken,
    p_expires_at: expiresAt,
  })
  if (!error) return true
  if (!isMissingRpc(error)) {
    console.error(`Cloud token update failed (code ${error.code || '-'})`)
    return false
  }
  const update: Record<string, string> = { access_token: accessToken, expires_at: expiresAt }
  if (refreshToken) update.refresh_token = refreshToken
  const { error: legacyError } = await supabaseAdmin
    .from('cloud_connections')
    .update(update)
    .eq('id', connectionId)
    .eq('user_id', userId)
  if (legacyError) {
    console.error(`Cloud token update failed (code ${legacyError.code || '-'})`)
    return false
  }
  return true
}

async function getCaller(req: Request, supabaseAdmin: any) {
  const header = req.headers.get('Authorization') || ''
  const jwt = header.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return null
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(jwt)
    if (error || !data?.user?.id || data.user.is_anonymous === true) return null
    return data.user
  } catch (_err) {
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Methode nicht erlaubt.' }, 405)
  }

  try {
    let payload: any
    try {
      payload = await req.json()
    } catch (_err) {
      throw new HttpError(400, 'Ungültige Anfrage.')
    }
    const applicantId = payload?.applicant_id ?? payload?.applicantId
    const processToken = payload?.process_token ?? payload?.processToken
    if (!isUuid(applicantId)) {
      throw new HttpError(400, 'Es wurde keine gültige Bewerbung angegeben.')
    }

    // Initialize Supabase admin client with service role key to bypass RLS and read storage
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    // 1. Fetch applicant and process details
    const { data: applicant, error: applicantError } = await supabaseAdmin
      .from('rental_applicants')
      .select('*, process:rental_processes(*)')
      .eq('id', applicantId)
      .maybeSingle()

    if (applicantError) throw new Error(`Applicant lookup failed: ${applicantError.message}`)
    const process = applicant?.process
    if (!applicant || !process) {
      throw new HttpError(404, 'Die Bewerbung wurde nicht gefunden.')
    }

    // 2. Zugriff prüfen
    const caller = await getCaller(req, supabaseAdmin)
    const isOwner = !!caller && caller.id === process.user_id
    if (!isOwner) {
      // Öffentlicher Aufruf (Vertrag C1)
      if (typeof processToken !== 'string' || processToken.length < 8 || processToken !== process.token) {
        throw new HttpError(403, 'Der Link zum Vermietungsprozess ist ungültig.')
      }
      if (process.status !== 'in_vermietung') {
        throw new HttpError(403, 'Dieser Vermietungsprozess ist nicht (mehr) aktiv.')
      }
      if (!isRecent(applicant.created_at, PUBLIC_SYNC_WINDOW_MS)) {
        throw new HttpError(409, 'Die Unterlagen können nur direkt nach dem Absenden der Bewerbung übertragen werden.')
      }
    }

    const landlordId = process.user_id
    const unitId = process.unit_id

    // Fetch unit and property
    const { data: unit, error: unitError } = await supabaseAdmin
      .from('units')
      .select('*')
      .eq('id', unitId)
      .maybeSingle()

    if (unitError || !unit) {
      throw new Error('Unit not found')
    }

    const { data: property, error: propError } = await supabaseAdmin
      .from('properties')
      .select('*')
      .eq('id', unit.property_id)
      .maybeSingle()

    if (propError || !property) {
      throw new Error('Property not found')
    }

    // 3. Fetch list of files in storage for this applicant (nur Dateien, keine Unterordner)
    // Ablage: neu "<process_id>/<applicant_id>/…" (SEC-LETTING), bisher "<applicant_id>/…"
    const storagePrefixes = [`${process.id}/${applicantId}`, applicantId]
    const allFiles: any[] = []
    for (const prefix of storagePrefixes) {
      const { data: storageList, error: storageError } = await supabaseAdmin
        .storage
        .from(BUCKET)
        .list(prefix, { limit: 100 })

      if (storageError) {
        throw new Error(`Storage listing error: ${storageError.message}`)
      }
      for (const f of storageList || []) {
        if (f && f.id && f.name && f.name !== '.emptyFolderPlaceholder') {
          allFiles.push({ ...f, storagePath: `${prefix}/${f.name}` })
        }
      }
    }
    if (allFiles.length === 0) {
      // No files uploaded, return success early
      return json({ success: true, transferred: 0, remaining_in_storage: 0, message: 'No documents to sync.' })
    }

    // Typ-, Größen- und Mengenbegrenzung
    const skipped: string[] = []
    const files = allFiles.filter((f: any) => {
      const ext = fileExtension(f.name)
      const size = Number(f.metadata?.size ?? 0)
      const ok = !!ALLOWED_EXTENSIONS[ext] && size <= MAX_FILE_BYTES
      if (!ok) skipped.push(f.name)
      return ok
    }).slice(0, MAX_FILES)
    if (allFiles.length - skipped.length > MAX_FILES) {
      console.warn(`Applicant ${applicantId}: more than ${MAX_FILES} files, only the first ${MAX_FILES} are transferred.`)
    }

    const pendingResponse = (reason: string, transferred = 0) => {
      console.warn(`Applicant ${applicantId}: documents kept in storage (${reason}).`)
      return json({
        success: false,
        pending: true,
        transferred,
        remaining_in_storage: allFiles.length - transferred,
        message: 'Die Unterlagen konnten noch nicht in die Cloud des Vermieters übertragen werden und verbleiben vorerst im Speicher der Plattform.',
      })
    }

    if (files.length === 0) {
      return pendingResponse('no allowed files')
    }

    // 4. Cloud des Vermieters bestimmen – wie Cloud Explorer und cloud-sync:
    //    Zuweisung des Portfolios (portfolio_cloud_links), sonst nur die einzige Verbindung.
    const { data: connections, error: connError } = await supabaseAdmin
      .from('cloud_connections')
      .select('id, user_id, provider, expires_at, created_at')
      .eq('user_id', landlordId)
      .order('created_at', { ascending: true })

    if (connError) {
      return pendingResponse(`cloud connection lookup failed (${connError.code || '-'})`)
    }
    if (!connections || connections.length === 0) {
      return pendingResponse('no cloud connection')
    }

    let connection: any = null
    if (property.portfolio_id) {
      const { data: link, error: linkError } = await supabaseAdmin
        .from('portfolio_cloud_links')
        .select('cloud_connection_id')
        .eq('user_id', landlordId)
        .eq('portfolio_id', property.portfolio_id)
        .maybeSingle()
      if (linkError) {
        return pendingResponse(`portfolio cloud link lookup failed (${linkError.code || '-'})`)
      }
      if (link?.cloud_connection_id) {
        connection = connections.find((c: any) => c.id === link.cloud_connection_id) || null
      }
    }
    if (!connection && connections.length === 1) connection = connections[0]
    if (!connection) {
      // Mehrere Clouds, aber keine Zuweisung für dieses Portfolio: nicht raten
      return pendingResponse('no cloud assigned to the portfolio')
    }

    const provider = connection.provider
    if (provider !== 'onedrive' && provider !== 'googledrive') {
      return pendingResponse(`unsupported provider ${provider}`)
    }
    const tokens = await readCloudTokens(supabaseAdmin, connection.id, landlordId)
    if (!tokens) {
      return pendingResponse('cloud tokens not readable')
    }
    let accessToken = tokens.accessToken

    // Refresh cloud token if expired
    const expiresAt = new Date(connection.expires_at)
    if (!accessToken || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
      if (!tokens.refreshToken) {
        return pendingResponse('no refresh token')
      }
      const tokenUrl = provider === 'onedrive'
        ? 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
        : 'https://oauth2.googleapis.com/token'
      let res: Response
      try {
        res = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: Deno.env.get(provider === 'onedrive' ? 'ONEDRIVE_CLIENT_ID' : 'GOOGLE_CLIENT_ID') ?? '',
            client_secret: Deno.env.get(provider === 'onedrive' ? 'ONEDRIVE_CLIENT_SECRET' : 'GOOGLE_CLIENT_SECRET') ?? '',
            refresh_token: tokens.refreshToken,
            grant_type: 'refresh_token',
          }),
        })
      } catch (_err) {
        return pendingResponse('token endpoint unreachable')
      }
      const tokenResponse = await res.json().catch(() => ({}))
      if (!res.ok || !tokenResponse.access_token) {
        // Widerrufene/abgelaufene Verbindung: nichts löschen, Unterlagen bleiben im Speicher
        return pendingResponse(`token refresh failed (${res.status} ${tokenResponse.error || ''})`)
      }
      accessToken = tokenResponse.access_token as string
      const newExpiresAt = new Date(Date.now() + (Number(tokenResponse.expires_in) || 3600) * 1000)
      await storeCloudTokens(
        supabaseAdmin,
        connection.id,
        landlordId,
        accessToken,
        typeof tokenResponse.refresh_token === 'string' && tokenResponse.refresh_token ? tokenResponse.refresh_token : null,
        newExpiresAt.toISOString(),
      )
    }

    // Graph API helpers: Lesen (404 -> null) und Schreiben (jeder Fehler wirft)
    const graphRequest = async (endpoint: string, method: string, body: any = null, isRaw = false) => {
      const options: RequestInit = {
        method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': isRaw ? 'application/octet-stream' : 'application/json'
        }
      }
      if (body) options.body = isRaw ? body : JSON.stringify(body)
      return await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, options)
    }
    const graphGet = async (endpoint: string) => {
      const res = await graphRequest(endpoint, 'GET')
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`Graph API Error (${res.status})`)
      return await res.json()
    }
    const graphWrite = async (endpoint: string, method: string, body: any, isRaw = false) => {
      const res = await graphRequest(endpoint, method, body, isRaw)
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        const err: any = new Error(`Graph API Error (${res.status}): ${detail.slice(0, 300)}`)
        err.status = res.status
        throw err
      }
      return res.status === 204 ? null : await res.json()
    }

    // Google Drive helper
    const googleDriveCall = async (endpoint: string, method: string = 'GET', body: any = null, queryParams: any = null) => {
      let url = `https://www.googleapis.com/drive/v3${endpoint}`
      if (queryParams) {
        url += `?${new URLSearchParams(queryParams).toString()}`
      }
      const options: RequestInit = {
        method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
      if (body) options.body = JSON.stringify(body)
      const res = await fetch(url, options)
      if (!res.ok) {
        if (res.status === 404 && method === 'GET') return null
        throw new Error(`Google Drive API Error (${res.status})`)
      }
      return res.status === 204 ? null : await res.json()
    }

    // 5. Calculate Property display name (wie cloud-sync)
    let propertyFolderRaw = ''
    if (property.economic_unit_id) {
      const { data: relatedProps } = await supabaseAdmin
        .from('properties')
        .select('street, house_number')
        .eq('economic_unit_id', property.economic_unit_id)
        .order('street')

      const groupedByStreet: Record<string, string[]> = {}
      ;(relatedProps || []).forEach((m: any) => {
        if (!m.street) return
        if (!groupedByStreet[m.street]) groupedByStreet[m.street] = []
        if (m.house_number) {
          groupedByStreet[m.street].push(m.house_number)
        }
      })
      const parts = Object.keys(groupedByStreet).map(street => {
        const nums = groupedByStreet[street]
        if (nums.length > 0) {
          return `${cloudFolderSegment(street)} ${nums.map(cloudFolderSegment).join(' & ')}`
        }
        return cloudFolderSegment(street)
      })
      const displayNames = parts.slice(0, 2).join(' | ')
      const groupName = parts.length > 2 ? `${displayNames} u.a.` : displayNames
      propertyFolderRaw = `WG: ${groupName || 'Wirtschaftsgemeinschaft'}`
    } else {
      propertyFolderRaw = `${cloudFolderSegment(property.street)} ${cloudFolderSegment(property.house_number || '')}`.trim()
    }

    // Alle Segmente einzeln bereinigt – keine Pfad-Zusammensetzung aus Rohwerten
    const applicantRaw = `${applicant.last_name || ''}_${applicant.first_name || ''}`.replace(/\s+/g, '_')
    const segments = [
      cleanSegment(propertyFolderRaw, 'Objekt', provider),
      'Neuvermietung',
      cleanSegment(cloudFolderSegment(unit.unit_name), 'Einheit', provider),
      cleanSegment(applicantRaw.replace(/^_+|_+$/g, ''), `Bewerber_${applicantId.slice(0, 8)}`, provider),
    ]

    let transferred = 0
    const failed: string[] = []

    const downloadFile = async (file: any) => {
      const { data: fileBlob, error: downloadError } = await supabaseAdmin
        .storage
        .from(BUCKET)
        .download(file.storagePath)
      if (downloadError || !fileBlob) {
        console.error(`Error downloading ${file.name}:`, downloadError?.message || downloadError)
        return null
      }
      if (fileBlob.size > MAX_FILE_BYTES) {
        console.warn(`File ${file.name} exceeds size limit, skipped.`)
        return null
      }
      return fileBlob
    }

    const removeFromStorage = async (file: any) => {
      const { error: removeErr } = await supabaseAdmin.storage.from(BUCKET).remove([file.storagePath])
      if (removeErr) {
        console.error(`Could not remove ${file.name} from storage:`, removeErr.message)
        return false
      }
      return true
    }

    // 6. Transfer files level-by-level
    if (provider === 'onedrive') {
      // Ordner Ebene für Ebene über Item-IDs anlegen/auflösen (kein Roh-Pfad in der URL)
      const ensureChildFolder = async (parentId: string | null, name: string) => {
        const lookup = parentId
          ? `/me/drive/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(name)}`
          : `/me/drive/root:/${encodeURIComponent(name)}`
        let folder = await graphGet(lookup)
        if (!folder) {
          const childrenEndpoint = parentId
            ? `/me/drive/items/${encodeURIComponent(parentId)}/children`
            : `/me/drive/root/children`
          try {
            folder = await graphWrite(childrenEndpoint, 'POST', {
              name,
              folder: {},
              "@microsoft.graph.conflictBehavior": "fail"
            })
          } catch (err: any) {
            if (err?.status !== 409) throw err
            folder = await graphGet(lookup) // parallel angelegt
          }
        }
        if (!folder?.id || !folder.folder) throw new Error('OneDrive folder could not be resolved')
        return folder.id as string
      }

      let parentId = await ensureChildFolder(null, APP_FOLDER_NAME)
      for (const segment of segments) {
        parentId = await ensureChildFolder(parentId, segment)
      }

      // Upload each file
      for (const file of files) {
        try {
          const fileBlob = await downloadFile(file)
          if (!fileBlob) { failed.push(file.name); continue }

          const arrayBuffer = await fileBlob.arrayBuffer()
          const safeFileName = cleanFileName(file.name, provider)
          const endpoint = `/me/drive/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(safeFileName)}:/content?@microsoft.graph.conflictBehavior=rename`

          // Upload to OneDrive – nur bei bestätigtem Ergebnis aus dem Speicher löschen
          const uploaded = await graphWrite(endpoint, 'PUT', arrayBuffer, true)
          if (!uploaded?.id) { failed.push(file.name); continue }

          if (await removeFromStorage(file)) transferred++
          else failed.push(file.name)
        } catch (err: any) {
          console.error(`OneDrive upload failed for ${file.name}:`, err?.message || err)
          failed.push(file.name)
        }
      }
    } else {
      // Google Drive
      const findOrCreateFolder = async (name: string, parentId: string) => {
        const search = await googleDriveCall('/files', 'GET', null, {
          q: `name = '${gq(name)}' and '${gq(parentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name)'
        })
        let folder = search?.files?.[0]
        if (!folder) {
          folder = await googleDriveCall('/files', 'POST', {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
          })
        }
        if (!folder?.id) throw new Error('Google Drive folder could not be resolved')
        return folder.id as string
      }

      let targetFolderId = await findOrCreateFolder(APP_FOLDER_NAME, 'root')
      for (const segment of segments) {
        targetFolderId = await findOrCreateFolder(segment, targetFolderId)
      }

      const encoder = new TextEncoder()

      // Upload each file (multipart: Inhalt + Name + Zielordner in einem Schritt)
      for (const file of files) {
        try {
          const fileBlob = await downloadFile(file)
          if (!fileBlob) { failed.push(file.name); continue }

          const data = new Uint8Array(await fileBlob.arrayBuffer())
          const ext = fileExtension(file.name)
          const mimeType = ALLOWED_EXTENSIONS[ext] || fileBlob.type || 'application/octet-stream'
          const boundary = `immo${crypto.randomUUID().replace(/-/g, '')}`
          const meta = JSON.stringify({ name: cleanFileName(file.name, provider), parents: [targetFolderId] })
          const head = encoder.encode(
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
            `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
          )
          const tail = encoder.encode(`\r\n--${boundary}--`)
          const body = new Uint8Array(head.length + data.length + tail.length)
          body.set(head, 0)
          body.set(data, head.length)
          body.set(tail, head.length + data.length)

          const resUpload = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': `multipart/related; boundary=${boundary}`
            },
            body
          })
          const uploadedFile = await resUpload.json().catch(() => ({}))
          if (!resUpload.ok || !uploadedFile.id) {
            console.error(`Google Drive upload failed for ${file.name}: HTTP ${resUpload.status}`)
            failed.push(file.name)
            continue
          }

          if (await removeFromStorage(file)) transferred++
          else failed.push(file.name)
        } catch (err: any) {
          console.error(`Google Drive upload failed for ${file.name}:`, err?.message || err)
          failed.push(file.name)
        }
      }
    }

    const remaining = allFiles.length - transferred
    if (failed.length > 0 || skipped.length > 0) {
      console.warn(`Applicant ${applicantId}: ${transferred} transferred, ${failed.length} failed, ${skipped.length} skipped.`)
    }
    return json({
      success: failed.length === 0 && remaining === 0,
      pending: remaining > 0,
      transferred,
      failed: failed.length,
      skipped: skipped.length,
      remaining_in_storage: remaining,
      message: remaining === 0
        ? 'All documents synced and storage purged.'
        : 'Ein Teil der Unterlagen konnte nicht übertragen werden und verbleibt vorerst im Speicher der Plattform.',
    })

  } catch (error: any) {
    if (error instanceof HttpError) {
      return json({ success: false, error: error.message }, error.status)
    }
    console.error('sync-applicant-files error:', error?.message || error)
    return json({ success: false, error: 'Die Unterlagen konnten nicht übertragen werden.' }, 500)
  }
})
