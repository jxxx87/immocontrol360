const { Client } = require('pg');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    const connectionString = `postgres://postgres.${projectId}:${password}@aws-1-eu-west-1.pooler.supabase.com:6543/postgres`;
    const pgClient = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    let connection = null;
    try {
        await pgClient.connect();
        const res = await pgClient.query("SELECT * FROM cloud_connections WHERE provider = 'onedrive' LIMIT 1");
        connection = res.rows[0];
    } catch (e) {
        console.error("PG Query failed:", e.message);
        return;
    } finally {
        await pgClient.end();
    }

    if (!connection) {
        console.error("No OneDrive connection found in DB.");
        return;
    }

    let accessToken = connection.access_token;

    const msGraphCall = async (endpoint) => {
        const url = `https://graph.microsoft.com/v1.0${endpoint}`;
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        if (!res.ok) {
            const err = await res.text();
            console.error(`Graph API Error (${res.status}):`, err);
            return null;
        }
        return await res.json();
    };

    const itemId = 'CC95D09E220E290!s7ba5956eb9a145eea2b2b78cb7c7f5d9';
    // Let's call the thumbnails endpoint
    console.log("Calling thumbnails endpoint...");
    const data = await msGraphCall(`/me/drive/items/${itemId}/thumbnails`);
    console.log("Thumbnails Response:");
    console.log(JSON.stringify(data, null, 2));
}

run();
