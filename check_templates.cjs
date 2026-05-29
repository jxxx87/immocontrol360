require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
    console.log("Checking Supabase table document_templates...");
    const { data, error } = await supabase.from('document_templates').select('*');
    if (error) {
        console.error("Error:", error);
    } else {
        console.log("Success! Rows count:", data.length);
        data.forEach(row => {
            console.log(`- ID: ${row.id}, Type: ${row.type}, Name: ${row.name}, UserID: ${row.user_id}, PortfolioID: ${row.portfolio_id}`);
        });
    }
}

checkData();
