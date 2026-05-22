const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf8');
const supabaseUrl = envFile.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = envFile.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data, error } = await supabase.rpc('debug_execute_sql', {
        query: `SELECT tgname, relname FROM pg_trigger JOIN pg_class ON pg_trigger.tgrelid = pg_class.oid WHERE relname IN ('claim_events', 'claim_items')`
    });
    console.log(data, error);
}

run();
