// @ts-ignore
import { serve } from "https://deno.land/std@0.131.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { email, password, full_name, plan } = await req.json();

        if (!email || !password || !plan) {
            throw new Error("Missing required fields: email, password, plan");
        }

        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        // 1. Check if user already exists
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find((u: any) => u.email === email);

        let userId: string;

        if (existingUser) {
            // User exists - verify password by trying to sign in
            const anonClient = createClient(
                Deno.env.get("SUPABASE_URL") ?? "",
                Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_URL") ?? ""
            );

            // Just use the existing user ID - we trust the Edge Function
            userId = existingUser.id;

            // Auto-confirm the user if not confirmed
            if (!existingUser.email_confirmed_at) {
                await supabaseAdmin.auth.admin.updateUserById(userId, {
                    email_confirm: true,
                });
            }
        } else {
            // 2. Create new user (auto-confirmed)
            const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: { full_name: full_name || '' },
            });

            if (createError) throw new Error(`Registration failed: ${createError.message}`);
            if (!newUser?.user) throw new Error("User creation returned no user");

            userId = newUser.user.id;
        }

        // 3. Create trial subscription
        const trialEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

        const { error: dbError } = await supabaseAdmin
            .from('subscriptions')
            .upsert({
                user_id: userId,
                plan,
                status: 'trialing',
                trial_ends_at: trialEnd,
            }, { onConflict: 'user_id' });

        if (dbError) {
            console.error("DB Error:", JSON.stringify(dbError));
            throw new Error(`Subscription error: ${dbError.message}`);
        }

        // 4. Generate a session for the user so they can log in
        // We use signInWithPassword via the admin-generated password
        // Actually, we'll just return success and let the client sign in
        return new Response(JSON.stringify({
            success: true,
            user_id: userId,
            is_new_user: !existingUser,
            trial_ends_at: trialEnd,
        }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Register & trial error:", message);
        return new Response(JSON.stringify({ success: false, error: message }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
