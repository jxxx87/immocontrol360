const { Client } = require('pg');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    const connectionString = `postgres://postgres:${password}@db.${projectId}.supabase.co:5432/postgres`;
    
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    const sql = `
-- Fix 1: portfolios table
DROP POLICY IF EXISTS "Shared users can view portfolio" ON portfolios;
CREATE POLICY "Shared users can view portfolio"
    ON portfolios FOR SELECT
    USING (
        user_id = auth.uid() 
        OR EXISTS (
            SELECT 1 FROM portfolio_shares 
            WHERE portfolio_id = portfolios.id 
            AND shared_with_email = (auth.jwt() ->> 'email')
            AND status = 'accepted'
        )
    );

-- Fix 2: portfolio_shares table
DROP POLICY IF EXISTS "Users can view shares targeted to their email" ON portfolio_shares;
CREATE POLICY "Users can view shares targeted to their email"
    ON portfolio_shares FOR SELECT
    USING (shared_with_email = (auth.jwt() ->> 'email'));
    
-- Update the helper function to not query auth.users directly unless necessary,
-- but the helper is SECURITY DEFINER so it CAN query auth.users.
-- The problem was only in the RLS policies which run as the 'authenticated' role.
    `;
    
    try {
        await client.connect();
        await client.query(sql);
        console.log("RLS Policies fixed successfully.");
    } catch (e) {
        console.log(`Failed to execute: ${e.message}`);
    } finally {
        await client.end();
    }
}

run();
