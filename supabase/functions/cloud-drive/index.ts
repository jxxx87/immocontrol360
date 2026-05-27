import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing Authorization header')

    const jwt = authHeader.replace('Bearer ', '').trim()
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(jwt)
    if (userError || !user) throw new Error('User not found')

    let provider = 'onedrive';
    let action = '';
    let path = '';
    let itemId = '';
    let folderName = '';
    
    // Parse request
    const contentType = req.headers.get('content-type') || '';
    let fileToUpload: File | null = null;
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      action = formData.get('action') as string;
      path = formData.get('path') as string;
      provider = (formData.get('provider') as string) || 'onedrive';
      folderName = formData.get('folderName') as string;
      fileToUpload = formData.get('file') as File;
    } else {
      const body = await req.json();
      action = body.action;
      path = body.path;
      itemId = body.itemId;
      folderName = body.folderName;
      provider = body.provider || 'onedrive';
    }

    // Get connection
    const { data: connection, error: connError } = await supabaseClient
      .from('cloud_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', provider)
      .single()

    if (connError || !connection) throw new Error('No active cloud connection found')

    let accessToken = connection.access_token

    // Token refresh logic
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
        }
    }

    const msGraphCall = async (endpoint: string, method: string = 'GET', body: any = null, isBinary: boolean = false) => {
      const options: RequestInit = {
        method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        }
      }
      
      if (body) {
        if (isBinary) {
          options.body = body; 
        } else {
          // @ts-ignore
          options.headers['Content-Type'] = 'application/json';
          options.body = JSON.stringify(body);
        }
      }
      
      const res = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, options)
      
      if (!res.ok) {
        if (res.status === 404) return null;
        const err = await res.text()
        throw new Error(`Graph API Error (${res.status}): ${err}`)
      }
      return res.status === 204 ? { success: true } : await res.json()
    }

    // Google Drive API Helper
    const googleDriveCall = async (endpoint: string, method: string = 'GET', body: any = null, queryParams: any = null, isBinary: boolean = false) => {
      let url = `https://www.googleapis.com/drive/v3${endpoint}`
      if (queryParams) {
        const params = new URLSearchParams(queryParams)
        url += `?${params.toString()}`
      }
      const options: RequestInit = {
        method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        }
      }
      if (body) {
        if (isBinary) {
          options.body = body;
        } else {
          // @ts-ignore
          options.headers['Content-Type'] = 'application/json';
          options.body = JSON.stringify(body);
        }
      }
      const res = await fetch(url, options)
      
      if (!res.ok) {
        if (res.status === 404) return null;
        const err = await res.text()
        throw new Error(`Google Drive API Error (${res.status}): ${err}`)
      }
      return res.status === 204 ? { success: true } : await res.json()
    }

    const getGoogleFolderIdByPath = async (p: string) => {
      const segments = p.split('/').filter(s => s.length > 0);
      let currentParentId = 'root';
      
      for (const segment of segments) {
        const search = await googleDriveCall('/files', 'GET', null, {
          q: `name = '${segment.replace(/'/g, "\\'")}' and '${currentParentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name)'
        });
        const folder = search?.files?.[0];
        if (!folder) return null;
        currentParentId = folder.id;
      }
      return currentParentId;
    }

    if (provider === 'onedrive') {
      
      const sanitizePath = (p: string) => {
          return p.split('/').map(segment => segment.replace(/["*:<>?\/\\|]/g, '')).join('/');
      };

      if (action === 'list') {
        const cleanPath = path ? `/${sanitizePath(path)}` : '';
        const endpoint = `/me/drive/root:/ImmoControlpro360${cleanPath}:/children?$select=id,name,folder,file,webUrl,size,lastModifiedDateTime`;
        
        let data = await msGraphCall(endpoint);
        
        // If the folder itself is requested but empty/doesn't have children directly (sometimes graph api weirdness), or 404
        if (!data) return new Response(JSON.stringify({ files: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
        
        const files = data.value.map((f: any) => ({
            id: f.id,
            name: f.name,
            isFolder: !!f.folder,
            url: f.webUrl,
            size: f.size,
            updatedAt: f.lastModifiedDateTime
        }));
        
        return new Response(JSON.stringify({ files }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      }
      
      if (action === 'upload' && fileToUpload) {
         const cleanPath = path ? `/${sanitizePath(path)}` : '';
         const safeFileName = fileToUpload.name.replace(/["*:<>?\/\\|]/g, '');
         const endpoint = `/me/drive/root:/ImmoControlpro360${cleanPath}/${safeFileName}:/content`;
         
         const fileBuffer = await fileToUpload.arrayBuffer();
         const data = await msGraphCall(endpoint, 'PUT', fileBuffer, true);
         
         return new Response(JSON.stringify({ success: true, file: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      }
      
      if (action === 'delete' && itemId) {
         await msGraphCall(`/me/drive/items/${itemId}`, 'DELETE');
         return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      }

      if (action === 'create_folder') {
          if (!folderName) throw new Error('Missing folderName');
          
          const safeFolderName = folderName.replace(/["*:<>?\/\\|]/g, '');
          const cleanPath = path ? `/${sanitizePath(path)}` : '';
          
          let parentFolder = await msGraphCall(`/me/drive/root:/ImmoControlpro360${cleanPath}`);
          if (!parentFolder) throw new Error('Parent folder not found');

          const newFolder = await msGraphCall(`/me/drive/items/${parentFolder.id}/children`, 'POST', {
            name: safeFolderName,
            folder: {},
            "@microsoft.graph.conflictBehavior": "rename"
          });

          return new Response(JSON.stringify({ success: true, folder: newFolder }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      }
    }

    if (provider === 'googledrive') {
      if (action === 'list') {
        const cleanPath = path ? `ImmoControlpro360/${path}` : 'ImmoControlpro360';
        const folderId = await getGoogleFolderIdByPath(cleanPath);
        if (!folderId) return new Response(JSON.stringify({ files: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});

        const data = await googleDriveCall('/files', 'GET', null, {
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'files(id, name, mimeType, webViewLink, size, modifiedTime)'
        });

        const files = (data.files || []).map((f: any) => ({
            id: f.id,
            name: f.name,
            isFolder: f.mimeType === 'application/vnd.google-apps.folder',
            url: f.webViewLink,
            size: f.size ? parseInt(f.size) : 0,
            updatedAt: f.modifiedTime
        }));

        return new Response(JSON.stringify({ files }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      }

      if (action === 'upload' && fileToUpload) {
         // 1. Upload media binary
         const resUpload = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=media', {
           method: 'POST',
           headers: {
             'Authorization': `Bearer ${accessToken}`,
             'Content-Type': fileToUpload.type
           },
           body: await fileToUpload.arrayBuffer()
         });
         const uploadedFile = await resUpload.json();
         if (!uploadedFile.id) throw new Error(`Google Upload Failed: ${JSON.stringify(uploadedFile)}`);

         // 2. Resolve parent folder
         const parentId = await getGoogleFolderIdByPath(`ImmoControlpro360/${path}`);
         if (!parentId) throw new Error('Parent folder not found in Google Drive');

         // 3. Patch file metadata (name and move to parent)
         const data = await googleDriveCall(`/files/${uploadedFile.id}`, 'PATCH', {
           name: fileToUpload.name
         }, {
           addParents: parentId
         });

         return new Response(JSON.stringify({ success: true, file: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      }

      if (action === 'delete' && itemId) {
         await googleDriveCall(`/files/${itemId}`, 'DELETE');
         return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      }

      if (action === 'create_folder') {
          if (!folderName) throw new Error('Missing folderName');
          const cleanPath = path ? `ImmoControlpro360/${path}` : 'ImmoControlpro360';
          const parentId = await getGoogleFolderIdByPath(cleanPath);
          if (!parentId) throw new Error('Parent folder not found in Google Drive');

          const newFolder = await googleDriveCall('/files', 'POST', {
            name: folderName.trim(),
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
          });

          return new Response(JSON.stringify({ success: true, folder: newFolder }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      }
    }

    throw new Error('Action or provider not supported');

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
