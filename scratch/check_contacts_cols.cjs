const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.agsmqvvwfufenaiekuox:mYxTGLyU7yLIY7n8@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'contacts'
    `);
    console.log('Contacts Columns:', res.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
