const { Client } = require('pg');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    const connectionString = `postgres://postgres:${password}@db.${projectId}.supabase.co:5432/postgres`;
    
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    try {
        await client.connect();
        const res = await client.query(`
            SELECT pol.polname, pol.polcmd, pol.polqual, pol.polwithcheck
            FROM pg_policy pol
            JOIN pg_class tbl ON pol.polrelid = tbl.oid
            WHERE tbl.relname = 'portfolio_shares';
        `);
        console.log(res.rows);
    } catch (e) {
        console.log(`Failed to execute: ${e.message}`);
    } finally {
        await client.end();
    }
}

run();
