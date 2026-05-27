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
    const { provider, action, foldersToCreate } = await req.json()
    
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
        // Return null if not found (for checking folder existence)
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

    if (provider === 'onedrive') {
      const appFolderName = "ImmoControlpro360"
      
      if (action === 'check') {
        const rootFolder = await msGraphCall(`/me/drive/root:/${appFolderName}`)
        if (!rootFolder) {
           return new Response(JSON.stringify({ missingFolders: foldersToCreate }), {
             headers: { ...corsHeaders, 'Content-Type': 'application/json' },
             status: 200,
           })
        }
        const children = await msGraphCall(`/me/drive/items/${rootFolder.id}/children?$select=name`)
        const existingNames = children.value.map((c: any) => c.name)
        const missingFolders = foldersToCreate.filter((f: string) => !existingNames.includes(f.replace(/["*:<>?\/\\|]/g, '')))
        
        return new Response(JSON.stringify({ missingFolders }), {
           headers: { ...corsHeaders, 'Content-Type': 'application/json' },
           status: 200,
        })
      }

      // If action !== 'check', proceed to create
      // 1. Ensure Root Folder exists
      let rootFolder = await msGraphCall(`/me/drive/root:/${appFolderName}`)
      if (!rootFolder) {
        rootFolder = await msGraphCall(`/me/drive/root/children`, 'POST', {
          name: appFolderName,
          folder: {},
          "@microsoft.graph.conflictBehavior": "rename"
        })
      }

      // 2. Iterate over folders to create (Properties / WGs)
      const createdFolders = []
      
      for (const folderName of foldersToCreate) {
        // Sanitize folder name (remove invalid characters for OneDrive: " * : < > ? / \ |)
        const safeFolderName = folderName.replace(/["*:<>?\/\\|]/g, '')
        
        let propFolder = await msGraphCall(`/me/drive/root:/${appFolderName}/${safeFolderName}`)
        if (!propFolder) {
          propFolder = await msGraphCall(`/me/drive/items/${rootFolder.id}/children`, 'POST', {
            name: safeFolderName,
            folder: {},
            "@microsoft.graph.conflictBehavior": "replace"
          })
        }
        
        // 3. Create Default Subfolders inside the Property folder
        const subfolderPromises = DEFAULT_SUBFOLDERS.map(async (sub) => {
          let subF = await msGraphCall(`/me/drive/root:/${appFolderName}/${safeFolderName}/${sub}`)
          if (!subF) {
             return msGraphCall(`/me/drive/items/${propFolder.id}/children`, 'POST', {
               name: sub,
               folder: {},
               "@microsoft.graph.conflictBehavior": "replace"
             })
          }
          return subF
        })

        await Promise.all(subfolderPromises)
        createdFolders.push(propFolder.id)
      }

      return new Response(JSON.stringify({ success: true, createdFolders }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    if (provider === 'googledrive') {
      const appFolderName = "ImmoControlpro360"
      
      if (action === 'check') {
        const rootSearch = await googleDriveCall('/files', 'GET', null, {
          q: `name = '${appFolderName}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`,
          fields: 'files(id, name)'
        })
        const rootFolder = rootSearch?.files?.[0]
        
        if (!rootFolder) {
           return new Response(JSON.stringify({ missingFolders: foldersToCreate }), {
             headers: { ...corsHeaders, 'Content-Type': 'application/json' },
             status: 200,
           })
        }
        
        const childrenSearch = await googleDriveCall('/files', 'GET', null, {
          q: `'${rootFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name)'
        })
        const existingNames = (childrenSearch?.files || []).map((f: any) => f.name)
        const missingFolders = foldersToCreate.filter((f: string) => !existingNames.includes(f))
        
        return new Response(JSON.stringify({ missingFolders }), {
           headers: { ...corsHeaders, 'Content-Type': 'application/json' },
           status: 200,
        })
      }

      // Action 'create'
      // 1. Ensure Root Folder exists
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

      const createdFolders = []
      
      for (const folderName of foldersToCreate) {
        // Search if already exists
        const propSearch = await googleDriveCall('/files', 'GET', null, {
          q: `name = '${folderName.replace(/'/g, "\\'")}' and '${rootFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name)'
        })
        let propFolder = propSearch?.files?.[0]
        
        if (!propFolder) {
          propFolder = await googleDriveCall('/files', 'POST', {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [rootFolder.id]
          })
        }
        
        // Create Default Subfolders inside the Property folder
        const subfolderPromises = DEFAULT_SUBFOLDERS.map(async (sub) => {
          const subSearch = await googleDriveCall('/files', 'GET', null, {
            q: `name = '${sub}' and '${propFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)'
          })
          let subF = subSearch?.files?.[0]
          
          if (!subF) {
             return googleDriveCall('/files', 'POST', {
               name: sub,
               mimeType: 'application/vnd.google-apps.folder',
               parents: [propFolder.id]
             })
          }
          return subF
        })

        await Promise.all(subfolderPromises)
        createdFolders.push(propFolder.id)
      }

      return new Response(JSON.stringify({ success: true, createdFolders }), {
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
