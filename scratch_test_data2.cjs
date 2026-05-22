const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf8');
const supabaseUrl = envFile.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = envFile.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data: claimId, error: err1 } = await supabase.rpc('get_random_active_plan');
    if (!claimId) {
        console.log("No active plan", err1);
        return;
    }
    console.log("Claim ID:", claimId);

    const { data: res, error } = await supabase.rpc('debug_trace_payment', {
        p_claim_id: claimId,
        p_amount: 121.91,
        p_installment_id: '00000000-0000-0000-0000-000000000000' // dummy uuid just to trigger NOT NULL
    });
    
    console.log("TRACE RESULT:", JSON.stringify(res, null, 2));
    if (error) console.log("ERROR:", error);
}

check();
