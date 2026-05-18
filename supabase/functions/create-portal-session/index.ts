/**
 * create-portal-session
 * 
 * Erstellt eine Stripe Customer Portal Session für eingeloggte User.
 * SDK-frei: Nutzt nur fetch() für Stripe API und Supabase REST API.
 */

// @ts-ignore
import { serve } from "https://deno.land/std@0.131.0/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { user_id, return_url } = await req.json();

        if (!user_id) {
            throw new Error("Missing required field: user_id");
        }

        // 1. Get stripe_customer_id from Supabase (via REST API)
        const dbRes = await fetch(
            `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user_id}&select=stripe_customer_id`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`,
                },
            }
        );
        const rows = await dbRes.json();

        if (!dbRes.ok || !rows || rows.length === 0 || !rows[0].stripe_customer_id) {
            return new Response(JSON.stringify({
                error: 'no_customer',
                message: 'Kein aktives Stripe-Konto gefunden. Bitte schließe zuerst ein Abo ab.'
            }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const customerId = rows[0].stripe_customer_id;

        // 2. Create Stripe Billing Portal Session (via REST API)
        const portalRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${STRIPE_SECRET}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "Stripe-Version": "2022-11-15",
            },
            body: new URLSearchParams({
                customer: customerId,
                return_url: return_url || "https://immocontrolpro360.de/settings",
            }).toString(),
        });

        const portalData = await portalRes.json();

        if (!portalRes.ok) {
            console.error("Stripe Portal error:", JSON.stringify(portalData));
            throw new Error(portalData.error?.message || "Failed to create portal session");
        }

        console.log(`Portal session created for customer ${customerId}`);

        return new Response(JSON.stringify({ url: portalData.url }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Portal session error:", message);
        return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
