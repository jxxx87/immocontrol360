const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    
    const sql = fs.readFileSync('supabase_migration_portfolio_shares.sql', 'utf8');
    
    // Direct connection string to Supabase
    const connectionString = `postgres://postgres:${password}@db.${projectId}.supabase.co:5432/postgres`;
    console.log(`Connecting to ${connectionString.replace(password, '***')}...`);
    
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        await client.connect();
        console.log(`Connected! Executing SQL...`);
        await client.query(sql);
        console.log(`Migration executed successfully.`);
    } catch (e) {
        console.log(`Failed to execute: ${e.message}`);
    } finally {
        await client.end();
    }
}

run();
