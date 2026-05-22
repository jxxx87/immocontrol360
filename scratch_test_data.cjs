const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf8');
const supabaseUrl = envFile.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = envFile.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: 'info@immo-control-pro.de',
        password: 'password123' // Try standard password, or I can bypass if I just query... wait RLS is active.
    });

    if (authError) {
        console.log("Auth Error:", authError);
        return;
    }

    const { data: claims } = await supabase.from('claims').select('id, status');
    console.log("Claims:", claims);

    if (claims && claims.length > 0) {
        const claimId = claims[0].id; // or find the one with payment_plan_active
        const { data: items } = await supabase.from('claim_items').select('*').eq('claim_id', claimId);
        console.log("Claim Items:", items);

        const { data: plan } = await supabase.from('payment_plans').select('*').eq('claim_id', claimId);
        console.log("Payment Plan:", plan);
        
        const { data: view } = await supabase.from('claim_item_totals_view').select('*').eq('claim_id', claimId);
        console.log("View:", view);
    }
}

check();
