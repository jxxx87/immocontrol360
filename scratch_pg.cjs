const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf8');
const supabaseUrl = envFile.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = envFile.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data: viewDef, error } = await supabase.rpc('debug_get_last_payment'); // Or just fetch claim_item_totals_view
    // Let's just query a single claim item to see if it works
    const res = await supabase.from('claim_item_totals_view').select('*').limit(1);
    console.log(JSON.stringify(res, null, 2));
}

run();
