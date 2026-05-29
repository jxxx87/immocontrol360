const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  connectionString: 'postgresql://postgres.agsmqvvwfufenaiekuox:mYxTGLyU7yLIY7n8@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260529103000_sync_contacts_and_tenants.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Connecting to database...');
    await client.connect();
    
    console.log('Executing migration script...');
    await client.query(sql);
    
    console.log('Migration applied successfully!');
  } catch (err) {
    console.error('Error applying migration:', err);
  } finally {
    await client.end();
  }
}

run();
