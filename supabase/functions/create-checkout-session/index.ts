/**
 * create-checkout-session
 * 
 * Erstellt eine Stripe Checkout Session.
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

// ─── STRIPE PRICE ID MAPPING ───
const PRICE_IDS: Record<string, Record<string, string>> = {
    starter: {
        monthly: "price_1T1GauFpRUY7TQZUpmxwYOJb",
        yearly: "price_1T1l3oFpRUY7TQZUtwi16wzf",
    },
    professional: {
        monthly: "price_1T1GbJFpRUY7TQZUPASgpSTz",
        yearly: "price_1T1l37FpRUY7TQZUwCuCfubf",
    },
    business: {
        monthly: "price_1T1GbhFpRUY7TQZUtvTFLgI7",
        yearly: "price_1T1l1xFpRUY7TQZUIEG7ATgZ",
    },
};

// ─── Stripe REST helpers ───
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
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET}`,
            "Stripe-Version": "2022-11-15",
        },
    });
    return res.json();
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { plan_id, billing_period, user_id } = await req.json();

        if (!plan_id || !billing_period || !user_id) {
            throw new Error("Missing required fields: plan_id, billing_period, user_id");
        }

        // 1. Get user email from Supabase Auth
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
            },
        });
        const userData = await userRes.json();
        if (!userRes.ok || !userData.email) throw new Error("User not found");

        const email = userData.email;

        // 2. Determine Stripe Price ID
        const planPrices = PRICE_IDS[plan_id];
        if (!planPrices) {
            throw new Error(`Unknown plan: ${plan_id}. Available: ${Object.keys(PRICE_IDS).join(', ')}`);
        }
        const priceId = billing_period === "yearly" ? planPrices.yearly : planPrices.monthly;
        if (!priceId) {
            throw new Error(`Price ID not found for ${plan_id} (${billing_period})`);
        }

        // 3. Find or create Stripe Customer
        const customersRes = await stripeGet(`/customers?email=${encodeURIComponent(email)}&limit=1`);
        let customerId = customersRes.data?.length > 0 ? customersRes.data[0].id : null;

        if (!customerId) {
            const newCustomer = await stripePost("/customers", {
                email,
                "metadata[supabase_uid]": user_id,
            });
            customerId = newCustomer.id;
        }

        // 4. Determine origin for redirect URLs
        const origin = req.headers.get("origin") || "https://immocontrolpro360.de";

        // 5. Create Stripe Checkout Session
        const sessionParams: Record<string, string> = {
            client_reference_id: user_id,
            customer: customerId,
            "line_items[0][price]": priceId,
            "line_items[0][quantity]": "1",
            mode: "subscription",
            success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/settings`,
            "metadata[user_id]": user_id,
            "subscription_data[metadata][user_id]": user_id,
            "subscription_data[metadata][plan]": plan_id,
            "subscription_data[metadata][billing_period]": billing_period,
            allow_promotion_codes: "true",
        };

        const session = await stripePost("/checkout/sessions", sessionParams);

        console.log(`Checkout session created: ${session.id} for user ${user_id}`);

        return new Response(JSON.stringify({ url: session.url }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Checkout session error:", message);
        return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
