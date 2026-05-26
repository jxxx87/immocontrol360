const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function run() {
    const filename = process.argv[2];
    if (!filename) {
        console.error("Please specify a SQL file, e.g. node apply_migration.cjs my_file.sql");
        process.exit(1);
    }
    
    if (!fs.existsSync(filename)) {
        console.error(`File not found: ${filename}`);
        process.exit(1);
    }

    const sql = fs.readFileSync(filename, 'utf8');
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    const connectionString = `postgres://postgres:${password}@db.${projectId}.supabase.co:5432/postgres`;
    
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    try {
        await client.connect();
        console.log(`Connected to database. Executing ${filename}...`);
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
