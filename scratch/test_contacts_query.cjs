const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://agsmqvvwfufenaiekuox.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc21xdnZ3ZnVmZW5haWVrdW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MTcxNTEsImV4cCI6MjA4NjI5MzE1MX0.z3CP6Kn9QIoZkyK2cvcIqa3kaWckyj9-oG_dyZzsjeM';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const { data, error } = await supabase
        .from('contacts')
        .select(`
            *,
            tenant:tenants (
                id,
                leases (
                    id,
                    status,
                    unit:units (
                        id,
                        property_id
                    )
                )
            )
        `)
        .order('name', { ascending: true });

    if (error) {
        console.error('Supabase Query Error:', error);
    } else {
        console.log('Query success! Count:', data.length);
        if (data.length > 0) {
            console.log('First item:', JSON.stringify(data[0], null, 2));
        }
    }
}

test();
