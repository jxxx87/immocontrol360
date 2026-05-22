import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://agsmqvvwfufenaiekuox.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc21xdnZ3ZnVmZW5haWVrdW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MTcxNTEsImV4cCI6MjA4NjI5MzE1MX0.z3CP6Kn9QIoZkyK2cvcIqa3kaWckyj9-oG_dyZzsjeM'
);

async function checkSchema() {
  console.log("Checking Supabase tables via REST...");
  const tablesToCheck = ['leases', 'tenants', 'rent_ledger', 'rent_payments', 'documents'];
  
  const { data, error } = await supabase.from('rent_payments').insert([{}]).select();
  console.log('Insert error:', error);
}

checkSchema().catch(console.error);
