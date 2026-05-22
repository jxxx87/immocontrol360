const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf8');
const supabaseUrl = envFile.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = envFile.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
    try {
        console.log('Reading migration file...');
        const sql = fs.readFileSync('supabase_migration_portfolio_shares.sql', 'utf8');
        
        console.log('Executing SQL via RPC debug_execute_sql...');
        const { data, error } = await supabase.rpc('debug_execute_sql', {
            query: sql
        });
        
        if (error) {
            console.error('Migration failed:', error);
        } else {
            console.log('Migration successful!', data);
        }
    } catch (err) {
        console.error('Error:', err);
    }
}

runMigration();
