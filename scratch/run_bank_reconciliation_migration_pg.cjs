const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function run() {
    const filename = path.join(__dirname, '../supabase/migrations/20260529160000_bank_reconciliation.sql');
    if (!fs.existsSync(filename)) {
        console.error(`File not found: ${filename}`);
        process.exit(1);
    }

    const sql = fs.readFileSync(filename, 'utf8');
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    
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
