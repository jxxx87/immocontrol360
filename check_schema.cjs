const { Client } = require('pg');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    const connectionString = `postgresql://postgres.${projectId}:${password}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`;
    
    console.log("Connecting with pooler...");
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    try {
        await client.connect();
        console.log("Connected successfully!");

        // 1. Get columns of document_templates
        console.log("=== COLUMNS ===");
        const cols = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'document_templates'
            ORDER BY ordinal_position;
        `);
        console.log(cols.rows);

        // 2. Get unique/primary key constraints of document_templates
        console.log("\n=== CONSTRAINTS ===");
        const constraints = await client.query(`
            SELECT conname, pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE conrelid = 'document_templates'::regclass;
        `);
        console.log(constraints.rows);

        // 3. Get RLS policies of document_templates
        console.log("\n=== RLS POLICIES ===");
        const policies = await client.query(`
            SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
            FROM pg_policies
            WHERE tablename = 'document_templates';
        `);
        console.log(policies.rows);

        // 4. Check if RLS is enabled
        console.log("\n=== RLS ENABLED ===");
        const rlsEnabled = await client.query(`
            SELECT relname, relrowsecurity, relforcerowsecurity
            FROM pg_class
            WHERE oid = 'document_templates'::regclass;
        `);
        console.log(rlsEnabled.rows);
        
    } catch (e) {
        console.log(`Failed to execute: ${e.message}`);
    } finally {
        await client.end();
    }
}

run();
