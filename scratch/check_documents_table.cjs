const { Client } = require('pg');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const connectionString = `postgresql://postgres.agsmqvvwfufenaiekuox:${password}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`;
    
    const client = new Client({ 
        connectionString, 
        ssl: { rejectUnauthorized: false } 
    });
    
    try {
        await client.connect();
        const res = await client.query("SELECT id, file_name, file_path, mime_type, category FROM documents LIMIT 10");
        console.log("Documents rows:");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error("Error:", e.message);
    } finally {
        await client.end();
    }
}

run();
