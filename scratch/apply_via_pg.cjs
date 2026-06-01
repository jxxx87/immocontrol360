const { Client } = require('pg');
const fs = require('fs');

async function run() {
    const sql = fs.readFileSync('supabase/migrations/20260601151000_add_thumbnail_image_to_properties_and_units.sql', 'utf8');
    const password = "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    const connectionString = `postgres://postgres.${projectId}:${password}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`;
    
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    try {
        await client.connect();
        console.log("Connected to database via pooler. Executing SQL...");
        await client.query(sql);
        console.log("Migration executed successfully!");
    } catch (e) {
        console.error("Migration failed:", e.message);
    } finally {
        await client.end();
    }
}

run();
