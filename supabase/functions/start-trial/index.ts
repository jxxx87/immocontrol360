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
        const { user_id, plan } = await req.json();

        if (!user_id || !plan) {
            throw new Error("Missing required fields: user_id, plan");
        }

        // Use service role to bypass RLS
        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        // Calculate trial end (10 days from now)
        const trialEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

        // Upsert subscription (create or update) - using service role bypasses RLS
        const { data: sub, error: dbError } = await supabaseAdmin
            .from('subscriptions')
            .upsert({
                user_id,
                plan,
                status: 'trialing',
                trial_ends_at: trialEnd,
            }, { onConflict: 'user_id' })
            .select()
            .single();

        if (dbError) {
            console.error("DB Error:", JSON.stringify(dbError));
            throw new Error(`Database error: ${dbError.message}`);
        }

        return new Response(JSON.stringify({
            success: true,
            subscription: sub,
            trial_ends_at: trialEnd,
        }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Start trial error:", message);
        // Return 200 with error in body so client can read the message
        return new Response(JSON.stringify({ success: false, error: message }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
