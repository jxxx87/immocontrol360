/**
 * create-portal-checkout-session
 * 
 * Edge function to create a Stripe Checkout Session for a tenant.
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

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { token, pin, origin } = await req.json();

        if (!token || !pin) {
            throw new Error("Missing required fields: token, pin");
        }

        // 1. Validate token & pin by calling get_public_claim_by_token RPC
        console.log(`Validating portal credentials for token: ${token}...`);
        const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_claim_by_token`, {
            method: "POST",
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ p_token: token, p_pin: pin })
        });
        
        if (!rpcRes.ok) {
            const txt = await rpcRes.text();
            throw new Error(`Zugriff verweigert: ${txt}`);
        }
        
        const claimDetails = await rpcRes.json();
        const openAmount = claimDetails.totals?.total_due;
        
        if (!openAmount || openAmount <= 0) {
            throw new Error("Es steht kein offener Betrag aus für diese Forderung.");
        }
        
        const claimId = claimDetails.claim_id;

        // 2. Query claim to get user_id (landlord)
        const claimQueryRes = await fetch(`${SUPABASE_URL}/rest/v1/claims?id=eq.${claimId}&select=user_id`, {
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`
            }
        });
        const claimData = await claimQueryRes.json();
        if (!claimQueryRes.ok || claimData.length === 0) {
            throw new Error("Forderung nicht gefunden.");
        }
        const landlordId = claimData[0].user_id;

        // 3. Query profiles to get stripe_connect_id
        const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${landlordId}&select=stripe_connect_id,stripe_connect_enabled`, {
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`
            }
        });
        const profileData = await profileRes.json();
        if (!profileRes.ok || profileData.length === 0) {
            throw new Error("Vermieterprofil nicht gefunden.");
        }
        
        const stripeConnectId = profileData[0].stripe_connect_id;
        const stripeConnectEnabled = profileData[0].stripe_connect_enabled;
        
        if (!stripeConnectId || !stripeConnectEnabled) {
            throw new Error("Online-Zahlung ist für diesen Vermieter zurzeit nicht eingerichtet.");
        }

        // 4. Create Stripe Checkout Session
        const originUrl = origin || "https://immocontrolpro360.de";
        
        // Calculate fee: 2% of amount + 0.25 EUR flat (standard payment fee coverage)
        const feeAmount = Math.round((openAmount * 0.02 + 0.25) * 100) / 100;
        
        console.log(`Creating Checkout Session for claim ${claimId} with Connect ID ${stripeConnectId}. Amount: ${openAmount}, Fee: ${feeAmount}...`);
        
        const sessionParams: Record<string, string> = {
            "payment_method_types[0]": "card",
            "payment_method_types[1]": "sepa_debit",
            "payment_method_types[2]": "sofort",
            "payment_method_types[3]": "paypal",
            "line_items[0][price_data][currency]": "eur",
            "line_items[0][price_data][product_data][name]": `Ausstehende Forderung #${claimId.substring(0, 8)}`,
            "line_items[0][price_data][unit_amount]": Math.round(openAmount * 100).toString(),
            "line_items[0][price_data][product_data][description]": `Online-Bezahlung über Forderungsportal`,
            "line_items[0][quantity]": "1",
            "line_items[1][price_data][currency]": "eur",
            "line_items[1][price_data][product_data][name]": "Zahlungsdienstleister-Gebühr",
            "line_items[1][price_data][unit_amount]": Math.round(feeAmount * 100).toString(),
            "line_items[1][price_data][product_data][description]": "Transaktionsgebühr für Online-Zahlung (Stripe/PayPal/Lastschrift)",
            "line_items[1][quantity]": "1",
            mode: "payment",
            success_url: `${originUrl}/forderung/portal/${token}?payment=success`,
            cancel_url: `${originUrl}/forderung/portal/${token}?payment=cancel`,
            "transfer_data[destination]": stripeConnectId,
            "metadata[claim_id]": claimId,
            "metadata[claim_amount]": openAmount.toString(),
            "metadata[token]": token,
            "metadata[pin]": pin,
            "metadata[payment_type]": "claim_checkout"
        };

        const session = await stripePost("/checkout/sessions", sessionParams);

        return new Response(JSON.stringify({ url: session.url }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Checkout session creation error:", message);
        return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
