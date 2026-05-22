const { Client } = require('pg');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    const connectionString = `postgres://postgres:${password}@db.${projectId}.supabase.co:5432/postgres`;
    
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    try {
        await client.connect();
        
        // Find all tables that have a user_id or portfolio_id column
        const res = await client.query(`
            SELECT table_name, column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND column_name IN ('user_id', 'portfolio_id')
            ORDER BY table_name, column_name;
        `);
        console.log("Tables with user_id or portfolio_id:");
        console.log(res.rows);

        // Fetch policies for these tables
        const pols = await client.query(`
            SELECT tbl.relname as table_name, pol.polname, pol.polcmd, pol.polqual, pol.polwithcheck
            FROM pg_policy pol
            JOIN pg_class tbl ON pol.polrelid = tbl.oid
            ORDER BY tbl.relname, pol.polname;
        `);
        console.log("\nRLS Policies:");
        const relevantPolicies = pols.rows.filter(r => res.rows.some(t => t.table_name === r.table_name));
        console.log(relevantPolicies);

    } catch (e) {
        console.log(`Failed to execute: ${e.message}`);
    } finally {
        await client.end();
    }
}

run();
