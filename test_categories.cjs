require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY);

async function test() {
    console.log("Fetching all expense_categories...");
    const { data, error } = await supabase.from('expense_categories').select('*').limit(10);
    if (error) console.error("Error fetching:", error);
    else console.log("Data:", data);
}

test();
