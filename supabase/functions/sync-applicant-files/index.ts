import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { applicantId } = await req.json()
    if (!applicantId) {
      throw new Error('Missing applicantId')
    }

    // Initialize Supabase admin client with service role key to bypass RLS and read storage
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    // 1. Fetch applicant and process details
    const { data: applicant, error: applicantError } = await supabaseAdmin
      .from('rental_applicants')
      .select('*, process:rental_processes(*)')
      .eq('id', applicantId)
      .single()

    if (applicantError || !applicant) {
      throw new Error(`Applicant not found: ${applicantError?.message || ''}`)
    }

    const process = applicant.process
    if (!process) {
      throw new Error('Rental process not found for applicant')
    }
    
    const landlordId = process.user_id
    const unitId = process.unit_id

    // Fetch unit and property
    const { data: unit, error: unitError } = await supabaseAdmin
      .from('units')
      .select('*')
      .eq('id', unitId)
      .single()

    if (unitError || !unit) {
      throw new Error('Unit not found')
    }

    const { data: property, error: propError } = await supabaseAdmin
      .from('properties')
      .select('*')
      .eq('id', unit.property_id)
      .single()

    if (propError || !property) {
      throw new Error('Property not found')
    }

    // 2. Fetch list of files in storage for this applicant
    const { data: storageFiles, error: storageError } = await supabaseAdmin
      .storage
      .from('applicant-documents')
      .list(applicantId)

    if (storageError) {
      throw new Error(`Storage listing error: ${storageError.message}`)
    }

    if (!storageFiles || storageFiles.length === 0) {
      // No files uploaded, return success early
      return new Response(JSON.stringify({ success: true, message: 'No documents to sync.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // 3. Resolve landlord's cloud connection
    const { data: connectionData, error: connError } = await supabaseAdmin
      .from('cloud_connections')
      .select('*')
      .eq('user_id', landlordId)
      .limit(1)

    if (connError || !connectionData || connectionData.length === 0) {
      throw new Error('Landlord has no active cloud connection configured.')
    }

    const connection = connectionData[0]
    const provider = connection.provider
    let accessToken = connection.access_token

    // Refresh cloud token if expired
    const expiresAt = new Date(connection.expires_at)
    if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
      if (provider === 'onedrive') {
        const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: Deno.env.get('ONEDRIVE_CLIENT_ID')!,
            client_secret: Deno.env.get('ONEDRIVE_CLIENT_SECRET')!,
            refresh_token: connection.refresh_token,
            grant_type: 'refresh_token',
          }),
        })
        const tokenResponse = await res.json()
        if (tokenResponse.access_token) {
          accessToken = tokenResponse.access_token
          const newExpiresAt = new Date()
          newExpiresAt.setSeconds(newExpiresAt.getSeconds() + tokenResponse.expires_in)
          await supabaseAdmin.from('cloud_connections').update({
            access_token: accessToken,
            refresh_token: tokenResponse.refresh_token || connection.refresh_token,
            expires_at: newExpiresAt.toISOString()
          }).eq('id', connection.id)
        }
      } else if (provider === 'googledrive') {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
            client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
            refresh_token: connection.refresh_token,
            grant_type: 'refresh_token',
          }),
        })
        const tokenResponse = await res.json()
        if (tokenResponse.access_token) {
          accessToken = tokenResponse.access_token
          const newExpiresAt = new Date()
          newExpiresAt.setSeconds(newExpiresAt.getSeconds() + tokenResponse.expires_in)
          await supabaseAdmin.from('cloud_connections').update({
            access_token: accessToken,
            refresh_token: tokenResponse.refresh_token || connection.refresh_token,
            expires_at: newExpiresAt.toISOString()
          }).eq('id', connection.id)
        }
      }
    }

    // Graph API helper
    const msGraphCall = async (endpoint: string, method: string = 'GET', body: any = null, isRaw: boolean = false) => {
      const options: RequestInit = {
        method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': isRaw ? 'application/octet-stream' : 'application/json'
        }
      }
      if (body) {
        options.body = isRaw ? body : JSON.stringify(body)
      }
      const res = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, options)
      if (!res.ok) {
        if (res.status === 404) return null
        const err = await res.text()
        throw new Error(`Graph API Error (${res.status}): ${err}`)
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
        if (res.status === 404) return null
        const err = await res.text()
        throw new Error(`Google Drive API Error (${res.status}): ${err}`)
      }
      return res.status === 204 ? null : await res.json()
    }

    // 4. Calculate Property display name
    let propertyFolderName = ''
    if (property.economic_unit_id) {
      const { data: relatedProps } = await supabaseAdmin
        .from('properties')
        .select('*')
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
          return `${street} ${nums.join(' & ')}`
        }
        return street
      })
      const displayNames = parts.slice(0, 2).join(' | ')
      const groupName = parts.length > 2 ? `${displayNames} u.a.` : displayNames
      propertyFolderName = `WG: ${groupName || 'Wirtschaftsgemeinschaft'}`
    } else {
      propertyFolderName = `${property.street} ${property.house_number || ''}`.trim()
    }

    const appFolderName = "ImmoControlpro360"
    const unitName = unit.unit_name.replace(/[\/:*?"<>|]/g, '_')
    const applicantName = `${applicant.last_name}_${applicant.first_name}`.replace(/[\s\/:*?"<>|]/g, '_')

    // Target sub-path in cloud
    const targetSubPath = `${propertyFolderName}/Neuvermietung/${unitName}/${applicantName}`

    // 5. Transfer files level-by-level
    if (provider === 'onedrive') {
      // Helper to ensure target folder exists and return its details
      const ensurePathOneDrive = async (path: string) => {
        const segments = path.split('/').filter(s => s.length > 0)
        let currentParentId = "root"
        let currentPath = appFolderName
        
        // Ensure root app folder
        let rootFolder = await msGraphCall(`/me/drive/root:/${appFolderName}`)
        if (!rootFolder) {
          rootFolder = await msGraphCall(`/me/drive/root/children`, 'POST', {
            name: appFolderName,
            folder: {},
            "@microsoft.graph.conflictBehavior": "rename"
          })
        }
        currentParentId = rootFolder.id

        for (const segment of segments) {
          const safeSegment = segment.replace(/["*:<>?\/\\|]/g, '')
          currentPath = `${currentPath}/${safeSegment}`
          let folder = await msGraphCall(`/me/drive/root:/${currentPath}`)
          if (!folder) {
            folder = await msGraphCall(`/me/drive/items/${currentParentId}/children`, 'POST', {
              name: safeSegment,
              folder: {},
              "@microsoft.graph.conflictBehavior": "replace"
            })
          }
          currentParentId = folder.id
        }
        return currentParentId
      }

      await ensurePathOneDrive(targetSubPath)

      // Upload each file
      for (const file of storageFiles) {
        const filePath = `${applicantId}/${file.name}`
        
        // Download from Supabase
        const { data: fileBlob, error: downloadError } = await supabaseAdmin
          .storage
          .from('applicant-documents')
          .download(filePath)

        if (downloadError || !fileBlob) {
          console.error(`Error downloading ${file.name}:`, downloadError)
          continue
        }

        const arrayBuffer = await fileBlob.arrayBuffer()
        const safeFileName = file.name.replace(/["*:<>?\/\\|]/g, '')
        const endpoint = `/me/drive/root:/${appFolderName}/${targetSubPath}/${safeFileName}:/content`
        
        // Upload to OneDrive
        await msGraphCall(endpoint, 'PUT', arrayBuffer, true)

        // Delete from Supabase Storage to save space
        await supabaseAdmin.storage.from('applicant-documents').remove([filePath])
      }
    } else if (provider === 'googledrive') {
      // Ensure Google Drive path
      const getGoogleRootId = async () => {
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
        return rootFolder.id
      }

      const ensurePathGoogle = async (path: string) => {
        const rootId = await getGoogleRootId()
        const segments = path.split('/').filter(s => s.length > 0)
        let currentParentId = rootId

        for (const segment of segments) {
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
          currentParentId = folder.id
        }
        return currentParentId
      }

      const targetFolderId = await ensurePathGoogle(targetSubPath)

      // Upload each file
      for (const file of storageFiles) {
        const filePath = `${applicantId}/${file.name}`
        
        // Download from Supabase
        const { data: fileBlob, error: downloadError } = await supabaseAdmin
          .storage
          .from('applicant-documents')
          .download(filePath)

        if (downloadError || !fileBlob) {
          console.error(`Error downloading ${file.name}:`, downloadError)
          continue
        }

        const arrayBuffer = await fileBlob.arrayBuffer()
        
        // 1. Upload media binary
        const resUpload = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=media', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': fileBlob.type
          },
          body: arrayBuffer
        })
        const uploadedFile = await resUpload.json()
        if (uploadedFile.id) {
          // 2. Patch file name and move to target folder
          await googleDriveCall(`/files/${uploadedFile.id}`, 'PATCH', {
            name: file.name
          }, {
            addParents: targetFolderId
          })

          // Delete from Supabase Storage
          await supabaseAdmin.storage.from('applicant-documents').remove([filePath])
        }
      }
    }

    return new Response(JSON.stringify({ success: true, message: 'All documents synced and storage purged.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
