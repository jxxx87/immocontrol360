const { Client } = require('pg');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    const connectionString = `postgres://postgres:${password}@db.${projectId}.supabase.co:5432/postgres`;
    
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    try {
        await client.connect();
        
        // Find tables with portfolio_id
        const res = await client.query(`
            SELECT table_name, column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND column_name IN ('portfolio_id', 'property_id', 'unit_id', 'tenant_id')
            ORDER BY table_name, column_name;
        `);
        console.log(res.rows);
    } catch (e) {
        console.log(`Failed to execute: ${e.message}`);
    } finally {
        await client.end();
    }
}

run();
