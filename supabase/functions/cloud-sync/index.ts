import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEFAULT_SUBFOLDERS = [
  "Rechnungen",
  "Mietverträge",
  "Bilder",
  "Schriftverkehr",
  "Nebenkosten",
  "Versicherungen",
  "Energieausweise"
]

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { provider, action } = await req.json()
    
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing Authorization header')
    }

    const jwt = authHeader.replace('Bearer ', '').trim()
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(jwt)
    if (userError || !user) {
      throw new Error(`Auth Error: ${userError?.message || 'User not found'}`)
    }

    // Get active cloud connection
    const { data: connection, error: connError } = await supabaseClient
      .from('cloud_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', provider)
      .single()

    if (connError || !connection) {
      throw new Error('No active cloud connection found')
    }

    let accessToken = connection.access_token

    // Check if token is expired (or expires in less than 5 minutes)
    const expiresAt = new Date(connection.expires_at)
    if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
      if (provider === 'onedrive') {
        const clientId = Deno.env.get('ONEDRIVE_CLIENT_ID');
        const clientSecret = Deno.env.get('ONEDRIVE_CLIENT_SECRET');

        const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId!,
            client_secret: clientSecret!,
            refresh_token: connection.refresh_token,
            grant_type: 'refresh_token',
          }),
        });

        const tokenResponse = await res.json();
        if (tokenResponse.error) throw new Error(`Refresh Error: ${tokenResponse.error_description}`);

        accessToken = tokenResponse.access_token;
        const newExpiresAt = new Date();
        newExpiresAt.setSeconds(newExpiresAt.getSeconds() + tokenResponse.expires_in);

        await supabaseClient
          .from('cloud_connections')
          .update({
            access_token: accessToken,
            refresh_token: tokenResponse.refresh_token || connection.refresh_token,
            expires_at: newExpiresAt.toISOString()
          })
          .eq('id', connection.id)
      } else if (provider === 'googledrive') {
        const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
        const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId!,
            client_secret: clientSecret!,
            refresh_token: connection.refresh_token,
            grant_type: 'refresh_token',
          }),
        });

        const tokenResponse = await res.json();
        if (tokenResponse.error) throw new Error(`Google Refresh Error: ${tokenResponse.error_description || tokenResponse.error}`);

        accessToken = tokenResponse.access_token;
        const newExpiresAt = new Date();
        newExpiresAt.setSeconds(newExpiresAt.getSeconds() + tokenResponse.expires_in);

        await supabaseClient
          .from('cloud_connections')
          .update({
            access_token: accessToken,
            refresh_token: tokenResponse.refresh_token || connection.refresh_token,
            expires_at: newExpiresAt.toISOString()
          })
          .eq('id', connection.id)
      } else {
        throw new Error('Unsupported provider')
      }
    }

    // OneDrive Graph API Helper
    const msGraphCall = async (endpoint: string, method: string = 'GET', body: any = null) => {
      const options: RequestInit = {
        method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
      if (body) options.body = JSON.stringify(body)
      const res = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, options)
      
      if (!res.ok) {
        if (res.status === 404) return null
        const err = await res.text()
        throw new Error(`Graph API Error (${res.status}): ${err}`)
      }
      return res.status === 204 ? null : await res.json()
    }

    // Google Drive API Helper
    const googleDriveCall = async (endpoint: string, method: string = 'GET', body: any = null, queryParams: any = null) => {
      let url = `https://www.googleapis.com/drive/v3${endpoint}`
      if (queryParams) {
        const params = new URLSearchParams(queryParams)
        url += `?${params.toString()}`
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
        if (res.status === 404) return null
        const err = await res.text()
        throw new Error(`Google Drive API Error (${res.status}): ${err}`)
      }
      return res.status === 204 ? null : await res.json()
    }

    // 1. Fetch properties and units of the user
    const { data: props, error: propsError } = await supabaseClient
      .from('properties')
      .select('id, street, house_number, city, economic_unit_id')
      .order('street')

    if (propsError) throw propsError

    const { data: units, error: unitsError } = await supabaseClient
      .from('units')
      .select('id, property_id, unit_name')

    if (unitsError) throw unitsError

    // 2. Group properties and generate folder names
    const groups: Record<string, any> = {}
    const ungrouped: any[] = []
    
    const safeProps = props || []
    safeProps.forEach((p: any) => {
      if (p.economic_unit_id) {
        if (!groups[p.economic_unit_id]) {
          groups[p.economic_unit_id] = {
            id: p.economic_unit_id,
            isGroup: true,
            members: []
          }
        }
        groups[p.economic_unit_id].members.push(p)
      } else {
        ungrouped.push({ ...p, isGroup: false })
      }
    })

    const finalGrouped = [...Object.values(groups), ...ungrouped]
    
    finalGrouped.forEach((item: any) => {
      if (item.isGroup) {
        const groupedByStreet: Record<string, string[]> = {}
        item.members.forEach((m: any) => {
          if (!m.street) return
          if (!groupedByStreet[m.street]) groupedByStreet[m.street] = []
          if (m.house_number) {
            groupedByStreet[m.street].push(m.house_number)
          }
        })
        const parts = Object.keys(groupedByStreet).map(street => {
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

    // 3. Build expected folder paths list
    const expectedPaths: string[] = []
    
    finalGrouped.forEach((item: any) => {
      const folderName = item.displayFolderName
      
      // Standard folders
      DEFAULT_SUBFOLDERS.forEach(sub => {
        expectedPaths.push(`${folderName}/${sub}`)
      })
      
      // Neuvermietung structure
      // Collect units belonging to this property/group
      const propertyIds = item.isGroup ? item.members.map((m: any) => m.id) : [item.id]
      const relatedUnits = (units || []).filter((u: any) => propertyIds.includes(u.property_id))
      
      relatedUnits.forEach((unit: any) => {
        if (unit.unit_name) {
          expectedPaths.push(`${folderName}/Neuvermietung/${unit.unit_name}/Bilder`)
        }
      })
    })

    const appFolderName = "ImmoControlpro360"

    // OneDrive Sync
    if (provider === 'onedrive') {
      // Helper to ensure path exists in OneDrive
      const folderCacheOneDrive: Record<string, string> = {}
      
      const ensurePathOneDrive = async (path: string) => {
        const segments = path.split('/').filter(s => s.length > 0)
        let currentParentId = "root"
        let currentPath = appFolderName
        
        // Ensure root app folder first
        if (!folderCacheOneDrive[appFolderName]) {
          let rootFolder = await msGraphCall(`/me/drive/root:/${appFolderName}`)
          if (!rootFolder) {
            rootFolder = await msGraphCall(`/me/drive/root/children`, 'POST', {
              name: appFolderName,
              folder: {},
              "@microsoft.graph.conflictBehavior": "rename"
            })
          }
          folderCacheOneDrive[appFolderName] = rootFolder.id
        }
        currentParentId = folderCacheOneDrive[appFolderName]

        for (const segment of segments) {
          const safeSegment = segment.replace(/["*:<>?\/\\|]/g, '')
          currentPath = `${currentPath}/${safeSegment}`
          
          if (folderCacheOneDrive[currentPath]) {
            currentParentId = folderCacheOneDrive[currentPath]
            continue
          }

          let folder = await msGraphCall(`/me/drive/root:/${currentPath}`)
          if (!folder) {
            folder = await msGraphCall(`/me/drive/items/${currentParentId}/children`, 'POST', {
              name: safeSegment,
              folder: {},
              "@microsoft.graph.conflictBehavior": "replace"
            })
          }
          folderCacheOneDrive[currentPath] = folder.id
          currentParentId = folder.id
        }
        return currentParentId
      }

      if (action === 'check') {
        const missingPaths: string[] = []
        
        // Batch check paths
        const checkPromises = expectedPaths.map(async (path) => {
          const sanitizedPath = path.split('/').map(s => s.replace(/["*:<>?\/\\|]/g, '')).join('/')
          const folder = await msGraphCall(`/me/drive/root:/${appFolderName}/${sanitizedPath}`)
          if (!folder) {
            missingPaths.push(path)
          }
        })
        
        await Promise.all(checkPromises)
        
        return new Response(JSON.stringify({ missingFolders: missingPaths }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        })
      }

      // Action 'create'
      for (const path of expectedPaths) {
        await ensurePathOneDrive(path)
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // Google Drive Sync
    if (provider === 'googledrive') {
      // Helper to ensure path exists in Google Drive
      const folderCacheGoogle: Record<string, string> = {}

      // Ensure root folder first
      const getGoogleRootId = async () => {
        if (folderCacheGoogle[appFolderName]) return folderCacheGoogle[appFolderName]
        
        const rootSearch = await googleDriveCall('/files', 'GET', null, {
          q: `name = '${appFolderName}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`,
          fields: 'files(id, name)'
        })
        let rootFolder = rootSearch?.files?.[0]
        
        if (!rootFolder) {
          rootFolder = await googleDriveCall('/files', 'POST', {
            name: appFolderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: ['root']
          })
        }
        folderCacheGoogle[appFolderName] = rootFolder.id
        return rootFolder.id
      }

      const ensurePathGoogle = async (path: string) => {
        const rootId = await getGoogleRootId()
        const segments = path.split('/').filter(s => s.length > 0)
        let currentParentId = rootId

        for (const segment of segments) {
          const cacheKey = `${currentParentId}:${segment}`
          if (folderCacheGoogle[cacheKey]) {
            currentParentId = folderCacheGoogle[cacheKey]
            continue
          }

          const search = await googleDriveCall('/files', 'GET', null, {
            q: `name = '${segment.replace(/'/g, "\\'")}' and '${currentParentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)'
          })
          let folder = search?.files?.[0]
          
          if (!folder) {
            folder = await googleDriveCall('/files', 'POST', {
              name: segment,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [currentParentId]
            })
          }
          folderCacheGoogle[cacheKey] = folder.id
          currentParentId = folder.id
        }
        return currentParentId
      }

      if (action === 'check') {
        const rootSearch = await googleDriveCall('/files', 'GET', null, {
          q: `name = '${appFolderName}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`,
          fields: 'files(id, name)'
        })
        const rootFolder = rootSearch?.files?.[0]
        
        if (!rootFolder) {
          return new Response(JSON.stringify({ missingFolders: expectedPaths }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          })
        }

        const missingPaths: string[] = []
        
        // Helper to check path existence level-by-level
        const checkPathGoogle = async (path: string) => {
          const segments = path.split('/').filter(s => s.length > 0)
          let currentParentId = rootFolder.id
          
          for (const segment of segments) {
            const search = await googleDriveCall('/files', 'GET', null, {
              q: `name = '${segment.replace(/'/g, "\\'")}' and '${currentParentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
              fields: 'files(id, name)'
            })
            const folder = search?.files?.[0]
            if (!folder) {
              return false
            }
            currentParentId = folder.id
          }
          return true
        }

        for (const path of expectedPaths) {
          const exists = await checkPathGoogle(path)
          if (!exists) {
            missingPaths.push(path)
          }
        }

        return new Response(JSON.stringify({ missingFolders: missingPaths }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        })
      }

      // Action 'create'
      for (const path of expectedPaths) {
        await ensurePathGoogle(path)
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    throw new Error('Unsupported provider')

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
