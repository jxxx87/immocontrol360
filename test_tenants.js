import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://agsmqvvwfufenaiekuox.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc21xdnZ3ZnVmZW5haWVrdW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MTcxNTEsImV4cCI6MjA4NjI5MzE1MX0.z3CP6Kn9QIoZkyK2cvcIqa3kaWckyj9-oG_dyZzsjeM'
);

async function checkTenants() {
  const { data, error } = await supabase.from('tenants').select('*').limit(1);
  if (error) {
    console.error(error);
  } else {
    if (data.length > 0) {
      console.log(Object.keys(data[0]));
    } else {
      console.log("No rows, cannot infer columns from REST data easily.");
    }
  }
}

checkTenants().catch(console.error);
