import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:mYxTGLyU7yLIY7n8@db.agsmqvvwfufenaiekuox.supabase.co:5432/postgres'
});

async function checkSchema() {
  await client.connect();
  console.log("Connected to Supabase PostgreSQL");

  const tablesToCheck = ['leases', 'tenants', 'rent_ledger', 'rent_payments', 'documents'];
  for (const table of tablesToCheck) {
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = $1 
        AND column_name IN ('id', 'user_id')
    `, [table]);
    
    console.log(`\nTable: ${table}`);
    if (res.rows.length === 0) {
      console.log(`  -> Table not found or missing id/user_id!`);
    } else {
      res.rows.forEach(r => console.log(`  -> ${r.column_name}: ${r.data_type}`));
    }
  }

  await client.end();
}

checkSchema().catch(console.error);
