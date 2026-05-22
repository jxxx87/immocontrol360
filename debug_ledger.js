import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://agsmqvvwfufenaiekuox.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc21xdnZ3ZnVmZW5haWVrdW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MTcxNTEsImV4cCI6MjA4NjI5MzE1MX0.z3CP6Kn9QIoZkyK2cvcIqa3kaWckyj9-oG_dyZzsjeM'
);

async function testQuery() {
    const { data: ledgerData, error: ledgerError } = await supabase
        .from('rent_ledger')
        .select(`
            id, period_month, expected_rent, paid_amount, due_date,
            leases (
                id,
                units (
                    unit_name,
                    properties ( street, house_number, zip, city )
                ),
                tenants ( first_name, last_name )
            )
        `)
        .eq('status', 'open')
        .order('period_month', { ascending: false });

    if (ledgerError) {
        console.error('LEDGER ERROR:', ledgerError);
    } else {
        console.log('LEDGER SUCCESS, fetched', ledgerData.length);
    }

    const { data: activeClaims, error: claimsError } = await supabase
        .from('claim_items')
        .select('rent_ledger_id, claims!inner(status)')
        .not('claims.status', 'in', '("settled","cancelled","archived")')
        .not('rent_ledger_id', 'is', null);

    if (claimsError) {
        console.error('CLAIMS ERROR:', claimsError);
    } else {
        console.log('CLAIMS SUCCESS', activeClaims.length);
    }
}

testQuery();
