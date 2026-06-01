const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function run() {
    const filename = 'supabase/migrations/20260529153000_digital_letting_process.sql';
    if (!fs.existsSync(filename)) {
        console.error(`File not found: ${filename}`);
        process.exit(1);
    }

    const sql = fs.readFileSync(filename, 'utf8');
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    
    // Using correct regional transaction pooler host
    const connectionString = `postgresql://postgres.agsmqvvwfufenaiekuox:${password}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`;
    
    const client = new Client({ 
        connectionString, 
        ssl: { rejectUnauthorized: false } 
    });
    
    try {
        await client.connect();
        console.log(`Connected to database pooler. Executing ${filename}...`);
        await client.query(sql);
        console.log("Migration executed successfully!");
    } catch (e) {
        console.error("Migration failed:", e.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

run();
