// @ts-ignore
import { serve } from "https://deno.land/std@0.131.0/http/server.ts";

// ─── Stripe Webhook Signature Verification (Web Crypto) ───
async function verifyStripeSignature(
    payload: string,
    sigHeader: string,
    secret: string,
    tolerance = 300
): Promise<boolean> {
    const parts = sigHeader.split(",");
    let timestamp = "";
    const signatures: string[] = [];

    for (const part of parts) {
        const [key, value] = part.split("=");
        if (key === "t") timestamp = value;
        if (key === "v1") signatures.push(value);
    }

    if (!timestamp || signatures.length === 0) {
        throw new Error("Invalid Stripe-Signature header");
    }

    const ts = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > tolerance) {
        throw new Error(`Webhook timestamp too old (${now - ts}s)`);
    }

    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
    const expectedSig = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    return signatures.some((s) => s === expectedSig);
}

// ─── Config ───
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ─── Safe date conversion ───
function toISO(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === "number") {
        return value > 946684800 ? new Date(value * 1000).toISOString() : null;
    }
    if (typeof value === "string") {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
}

// ─── Stripe REST API (no SDK) ───
async function stripeGet(path: string): Promise<any> {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET}`,
            "Stripe-Version": "2022-11-15",
        },
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Stripe API error (${res.status}): ${txt}`);
    }
    return res.json();
}

// ─── Supabase REST API (no SDK) ───
async function supabaseSelect(
    table: string,
    query: string
): Promise<{ data: any; error: string | null }> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
        },
    });
    const data = await res.json();
    if (!res.ok) return { data: null, error: JSON.stringify(data) };
    return { data, error: null };
}

async function supabaseUpsert(
    table: string,
    body: Record<string, unknown>,
    conflictCol = "user_id"
): Promise<{ data: any; error: string | null }> {
    const conflictVal = body[conflictCol];

    // 1. Try UPDATE first
    const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?${conflictCol}=eq.${conflictVal}`,
        {
            method: "PATCH",
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
            },
            body: JSON.stringify(body),
        }
    );

    const patchData = await patchRes.json();

    if (patchRes.ok && Array.isArray(patchData) && patchData.length > 0) {
        console.log("Upsert: UPDATED existing row");
        return { data: patchData, error: null };
    }

    // 2. No existing row → INSERT
    console.log("Upsert: No existing row, INSERTING...");
    const postRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
        },
        body: JSON.stringify(body),
    });

    const postData = await postRes.json();
    if (!postRes.ok) return { data: null, error: JSON.stringify(postData) };
    console.log("Upsert: INSERTED new row");
    return { data: postData, error: null };
}

async function supabaseUpdate(
    table: string,
    query: string,
    body: Record<string, unknown>
): Promise<{ data: any; error: string | null }> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
        method: "PATCH",
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
        },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { data: null, error: JSON.stringify(data) };
    return { data, error: null };
}

// ─── Price ID → Plan mapping ───
const PRICE_TO_PLAN: Record<string, string> = {
    "price_1T1GauFpRUY7TQZUpmxwYOJb": "starter",
    "price_1T1l3oFpRUY7TQZUtwi16wzf": "starter",
    "price_1T1GbJFpRUY7TQZUPASgpSTz": "professional",
    "price_1T1l37FpRUY7TQZUwCuCfubf": "professional",
    "price_1T1GbhFpRUY7TQZUtvTFLgI7": "business",
    "price_1T1l1xFpRUY7TQZUIEG7ATgZ": "business",
};

// ═════════════════════════════════════════════════
// MAIN HANDLER
// ═════════════════════════════════════════════════
serve(async (req: Request) => {
    const signature = req.headers.get("Stripe-Signature");
    const body = await req.text();
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET") ?? "";

    console.log("=== STRIPE WEBHOOK ===");

    if (!signature || !webhookSecret) {
        console.error("Missing signature or webhook secret");
        return new Response("Missing signature or secret", { status: 400 });
    }

    // 1. Verify signature
    try {
        const valid = await verifyStripeSignature(body, signature, webhookSecret);
        if (!valid) {
            console.error("Signature INVALID");
            return new Response("Invalid signature", { status: 400 });
        }
    } catch (err) {
        console.error("Signature error:", (err as Error).message);
        return new Response(`Signature error: ${(err as Error).message}`, { status: 400 });
    }

    // 2. Parse event
    const event = JSON.parse(body);
    console.log(`Event: ${event.type} (${event.id})`);

    try {
        switch (event.type) {
            // ═══════════════════════════════════════
            // CHECKOUT COMPLETED
            // ═══════════════════════════════════════
            case "checkout.session.completed": {
                const session = event.data.object;
                console.log("mode:", session.mode, "sub:", session.subscription, "cust:", session.customer);

                if (session.metadata?.payment_type === "claim_checkout") {
                    const claimId = session.metadata.claim_id;
                    const amount = session.metadata.claim_amount 
                        ? parseFloat(session.metadata.claim_amount) 
                        : (session.amount_total / 100.0);
                    
                    console.log(`Processing claim checkout payment: claimId=${claimId}, amount=${amount} (excluding transaction fees)`);

                    // Call database RPC record_claim_payment
                    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_claim_payment`, {
                        method: "POST",
                        headers: {
                            apikey: SUPABASE_KEY,
                            Authorization: `Bearer ${SUPABASE_KEY}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            p_claim_id: claimId,
                            p_payment_date: new Date().toISOString().split('T')[0],
                            p_amount: amount,
                            p_note: "Online-Zahlung via Stripe Checkout",
                            p_installment_id: null,
                            p_target_type: "auto",
                            p_target_claim_item_id: null
                        })
                    });

                    if (!rpcRes.ok) {
                        const txt = await rpcRes.text();
                        console.error("RPC record_claim_payment failed:", txt);
                        throw new Error(`RPC failed: ${txt}`);
                    }
                    console.log(`✅ Successfully recorded payment of ${amount} EUR for claim ${claimId}`);
                    break;
                }

                if (session.mode !== "subscription" || !session.subscription) {
                    console.warn("Not a subscription checkout, skipping.");
                    break;
                }

                let userId = session.client_reference_id || session.metadata?.user_id;
                if (!userId) throw new Error("No user_id found");
                console.log("userId:", userId);

                // Fetch subscription from Stripe
                const sub = await stripeGet(`/subscriptions/${session.subscription}`);
                console.log("sub.status:", sub.status, "period_end:", sub.current_period_end, typeof sub.current_period_end);

                // Determine plan
                const priceId = sub.items?.data?.[0]?.price?.id;
                const productId = sub.items?.data?.[0]?.price?.product;
                let plan = PRICE_TO_PLAN[priceId] || null;

                if (!plan && productId) {
                    try {
                        const product = await stripeGet(`/products/${productId}`);
                        plan = product.metadata?.plan_id || null;
                    } catch (_e) { /* ignore */ }
                }
                plan = plan || "professional";
                console.log("plan:", plan, "priceId:", priceId);

                // UPSERT via Supabase REST
                const upsertData = {
                    user_id: userId,
                    stripe_customer_id: session.customer,
                    stripe_subscription_id: session.subscription,
                    status: "active",
                    plan: plan,
                    trial_ends_at: null,
                    current_period_end: toISO(sub.current_period_end),
                };
                console.log("UPSERT:", JSON.stringify(upsertData));

                const { data: result, error } = await supabaseUpsert("subscriptions", upsertData);
                if (error) {
                    console.error("UPSERT ERROR:", error);
                    throw new Error(`Upsert failed: ${error}`);
                }
                console.log("UPSERT OK:", JSON.stringify(result));
                console.log(`✅ Saved: user ${userId} → ${plan}`);
                break;
            }

            // ═══════════════════════════════════════
            // SUBSCRIPTION UPDATED / DELETED
            // ═══════════════════════════════════════
            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
                const eventSub = event.data.object;
                console.log(`${event.type}: sub.id=${eventSub.id} status=${eventSub.status}`);

                // Fetch fresh data from Stripe API (pinned version) for consistent format
                const sub = await stripeGet(`/subscriptions/${eventSub.id}`);
                console.log("Fetched sub from API: status=", sub.status, "period_end=", sub.current_period_end, typeof sub.current_period_end);

                // Find user
                const { data: rows, error: findError } = await supabaseSelect(
                    "subscriptions",
                    `stripe_subscription_id=eq.${sub.id}&select=user_id`
                );

                if (findError || !rows || rows.length === 0) {
                    console.warn("No matching subscription in DB, findError:", findError);
                    break;
                }

                const userId = rows[0].user_id;
                const updateData: Record<string, unknown> = {
                    status: sub.status,
                    current_period_end: toISO(sub.current_period_end),
                    updated_at: new Date().toISOString(),
                };

                // Determine plan for updates
                if (event.type === "customer.subscription.updated" && sub.items?.data?.length > 0) {
                    const currentPriceId = sub.items.data[0].price.id;
                    const newPlan = PRICE_TO_PLAN[currentPriceId];
                    if (newPlan) {
                        updateData.plan = newPlan;
                        console.log(`Plan → ${newPlan}`);
                    } else {
                        const productId = sub.items.data[0].price.product;
                        try {
                            const product = await stripeGet(`/products/${productId}`);
                            if (product.metadata?.plan_id) updateData.plan = product.metadata.plan_id;
                        } catch (_e) { /* ignore */ }
                    }
                }

                console.log("UPDATE:", JSON.stringify(updateData));
                const { data: updateResult, error: updateError } = await supabaseUpdate(
                    "subscriptions",
                    `user_id=eq.${userId}`,
                    updateData
                );

                if (updateError) {
                    console.error("UPDATE ERROR:", updateError);
                } else {
                    console.log(`✅ Updated: user ${userId}`, JSON.stringify(updateResult));
                }
                break;
            }

            // ═══════════════════════════════════════
            // CONNECT ACCOUNT UPDATED
            // ═══════════════════════════════════════
            case "account.updated": {
                const account = event.data.object;
                const connectId = account.id;
                const chargesEnabled = account.charges_enabled;
                const detailsSubmitted = account.details_submitted;
                
                console.log(`account.updated: id=${connectId}, charges_enabled=${chargesEnabled}, details_submitted=${detailsSubmitted}`);
                
                const enabled = chargesEnabled && detailsSubmitted;
                
                // Update profiles where stripe_connect_id matches
                const { data: updateRes, error: updateError } = await supabaseUpdate(
                    "profiles",
                    `stripe_connect_id=eq.${connectId}`,
                    { stripe_connect_enabled: enabled, updated_at: new Date().toISOString() }
                );
                
                if (updateError) {
                    console.error(`Failed to update profile for connect account ${connectId}:`, updateError);
                } else {
                    console.log(`✅ Updated profile stripe_connect_enabled to ${enabled} for account ${connectId}`);
                }
                break;
            }

            default:
                console.log("Unhandled:", event.type);
        }

        console.log("=== END (200) ===");
        return new Response(JSON.stringify({ received: true }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("=== ERROR:", msg, "===");
        return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});
