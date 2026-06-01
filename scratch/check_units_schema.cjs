const { Client } = require('pg');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    const connectionString = `postgresql://postgres.agsmqvvwfufenaiekuox:${password}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`;
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    try {
        await client.connect();
        
        // Check units table columns
        const resUnits = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'units' 
            ORDER BY ordinal_position;
        `);
        console.log("UNITS COLUMNS:");
        resUnits.rows.forEach(r => console.log(` - ${r.column_name}: ${r.data_type}`));

        // Check properties table columns
        const resProps = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'properties' 
            ORDER BY ordinal_position;
        `);
        console.log("\nPROPERTIES COLUMNS:");
        resProps.rows.forEach(r => console.log(` - ${r.column_name}: ${r.data_type}`));
        
    } catch (e) {
        console.error("Failed to query schema:", e.message);
    } finally {
        await client.end();
    }
}
run();
