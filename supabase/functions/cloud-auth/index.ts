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
    const { provider, code, redirectUri } = await req.json()
    
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

    let tokenResponse;
    let accountEmail = '';

    if (provider === 'googledrive') {
      const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
      const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId!,
          client_secret: clientSecret!,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      tokenResponse = await res.json();
      if (tokenResponse.error) throw new Error(tokenResponse.error_description || tokenResponse.error);

      // Fetch user email
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
      });
      const userData = await userRes.json();
      accountEmail = userData.email;

    } else if (provider === 'onedrive') {
      const clientId = Deno.env.get('ONEDRIVE_CLIENT_ID');
      const clientSecret = Deno.env.get('ONEDRIVE_CLIENT_SECRET');

      const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId!,
          scope: 'offline_access Files.ReadWrite.All User.Read',
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          client_secret: clientSecret!,
        }),
      });

      tokenResponse = await res.json();
      if (tokenResponse.error) throw new Error(tokenResponse.error_description || tokenResponse.error);

      // Fetch user email
      const userRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
      });
      const userData = await userRes.json();
      accountEmail = userData.userPrincipalName || userData.mail;
    } else {
      throw new Error('Unknown provider');
    }

    // Calculate expiry
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + tokenResponse.expires_in);

    // Save to database
    const { error: dbError } = await supabaseClient
      .from('cloud_connections')
      .insert({
        user_id: user.id,
        provider,
        account_email: accountEmail,
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        expires_at: expiresAt.toISOString(),
      });

    if (dbError) throw dbError;

    return new Response(
      JSON.stringify({ success: true, email: accountEmail }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
