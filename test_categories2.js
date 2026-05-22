import fs from 'fs';
import path from 'path';

function getEnv(key) {
    const content = fs.readFileSync(path.resolve('.env'), 'utf-8');
    const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : null;
}

const url = getEnv('VITE_SUPABASE_URL');
const key = getEnv('VITE_SUPABASE_SERVICE_ROLE_KEY') || getEnv('VITE_SUPABASE_ANON_KEY');

async function test() {
    const res = await fetch(`${url}/rest/v1/expense_categories?select=*&limit=5`, {
        headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`
        }
    });
    const data = await res.json();
    console.log(data);
}
test();
