const { Client } = require('pg');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    const connectionString = `postgresql://postgres.agsmqvvwfufenaiekuox:${password}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`;
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    try {
        await client.connect();
        
        // Check leases table columns
        const resLeases = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'leases' 
            ORDER BY ordinal_position;
        `);
        console.log("LEASES COLUMNS:");
        resLeases.rows.forEach(r => console.log(` - ${r.column_name}: ${r.data_type}`));
        
    } catch (e) {
        console.error("Failed to query schema:", e.message);
    } finally {
        await client.end();
    }
}
run();
