/**
 * stripe-connect-onboard
 * 
 * Edge function to onboard a user onto Stripe Connect Express.
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

async function stripePost(path: string, params: Record<string, string>): Promise<any> {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Stripe-Version": "2022-11-15",
        },
        body: new URLSearchParams(params).toString(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Stripe error: ${res.status}`);
    return data;
}

async function stripeGet(path: string): Promise<any> {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET}`,
            "Stripe-Version": "2022-11-15",
        },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Stripe error: ${res.status}`);
    return data;
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // 1. Get user authentication
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            throw new Error("Missing Authorization header");
        }

        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
                Authorization: authHeader,
            },
        });
        
        const userData = await userRes.json();
        if (!userRes.ok || !userData.id) {
            throw new Error("Invalid token or user not authenticated");
        }
        
        const userId = userData.id;
        const email = userData.email;

        // 2. Fetch the user's profile from the database
        const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=stripe_connect_id`, {
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
            },
        });
        const profileData = await profileRes.json();
        if (!profileRes.ok) {
            throw new Error("Failed to load profile from database");
        }
        
        let stripeConnectId = profileData[0]?.stripe_connect_id;
        let isAlreadyEnabled = false;

        if (stripeConnectId) {
            console.log(`Checking status for existing Stripe Connect Account: ${stripeConnectId}...`);
            try {
                const account = await stripeGet(`/accounts/${stripeConnectId}`);
                const chargesEnabled = account.charges_enabled;
                const detailsSubmitted = account.details_submitted;
                isAlreadyEnabled = chargesEnabled && detailsSubmitted;
                
                console.log(`Stripe Connect status for ${stripeConnectId}: charges_enabled=${chargesEnabled}, details_submitted=${detailsSubmitted}`);
                
                // Update database status
                const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
                    method: "PATCH",
                    headers: {
                        apikey: SUPABASE_KEY,
                        Authorization: `Bearer ${SUPABASE_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ 
                        stripe_connect_enabled: isAlreadyEnabled,
                        updated_at: new Date().toISOString()
                    }),
                });
                
                if (!updateRes.ok) {
                    console.error("Failed to update profile connection status in DB");
                }
            } catch (err: any) {
                console.error("Failed to retrieve account status from Stripe:", err.message);
            }
        }

        // If already connected, return early
        if (isAlreadyEnabled) {
            return new Response(JSON.stringify({ url: null, already_connected: true }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 3. Create Stripe Connect Express Account if not exists
        if (!stripeConnectId) {
            console.log(`Creating Stripe Connect Account for user ${userId} (${email})...`);
            const accountParams: Record<string, string> = {
                type: "express",
                country: "DE",
                email: email || "",
                "capabilities[card_payments][requested]": "true",
                "capabilities[transfers][requested]": "true",
                "business_type": "individual",
                "metadata[supabase_uid]": userId,
            };
            const account = await stripePost("/accounts", accountParams);
            stripeConnectId = account.id;

            console.log(`Saved Stripe Connect ID: ${stripeConnectId}. Updating profile...`);
            // Save stripe_connect_id to profiles table
            const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
                method: "PATCH",
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ stripe_connect_id: stripeConnectId }),
            });
            if (!updateRes.ok) {
                const txt = await updateRes.text();
                throw new Error(`Failed to update profile: ${txt}`);
            }
        }

        // 4. Create Account Link for onboarding
        const { origin } = await req.json();
        const originUrl = origin || "https://immocontrolpro360.de";

        console.log(`Creating account link for account ${stripeConnectId}...`);
        const linkParams: Record<string, string> = {
            account: stripeConnectId,
            refresh_url: `${originUrl}/forderungen?stripe_status=refresh`,
            return_url: `${originUrl}/forderungen?stripe_status=success`,
            type: "account_onboarding",
        };
        const accountLink = await stripePost("/account_links", linkParams);

        return new Response(JSON.stringify({ url: accountLink.url }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Stripe Connect onboarding error:", message);
        return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
