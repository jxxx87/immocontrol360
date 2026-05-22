const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:mYxTGLyU7yLIY7n8@db.agsmqvvwfufenaiekuox.supabase.co:5432/postgres'
});

async function run() {
  await client.connect();
  const res = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'rent_payments';`);
  console.log(res.rows);
  await client.end();
}
run();
