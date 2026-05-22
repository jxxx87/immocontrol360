const { Client } = require('pg');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    const connectionString = `postgres://postgres:${password}@db.${projectId}.supabase.co:5432/postgres`;
    
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    const sql = `
CREATE OR REPLACE FUNCTION get_pending_invitations()
RETURNS TABLE (
    id UUID,
    portfolio_id UUID,
    portfolio_name TEXT,
    sender_name TEXT,
    created_at TIMESTAMPTZ
)
SECURITY DEFINER
AS $$
DECLARE
    caller_email TEXT;
BEGIN
    caller_email := auth.jwt() ->> 'email';
    
    RETURN QUERY
    SELECT 
        ps.id,
        ps.portfolio_id,
        p.name AS portfolio_name,
        COALESCE(pr.first_name || ' ' || pr.last_name, p.company_name, 'Unbekannt') AS sender_name,
        ps.created_at
    FROM portfolio_shares ps
    JOIN portfolios p ON ps.portfolio_id = p.id
    LEFT JOIN profiles pr ON p.user_id = pr.id
    WHERE ps.shared_with_email = caller_email
    AND ps.status = 'pending';
END;
$$ LANGUAGE plpgsql;

-- Also create decline_portfolio_share to bypass RLS issues on delete
CREATE OR REPLACE FUNCTION decline_portfolio_share(share_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
AS $$
DECLARE
    caller_email TEXT;
    target_email TEXT;
BEGIN
    caller_email := auth.jwt() ->> 'email';
    
    SELECT shared_with_email INTO target_email
    FROM portfolio_shares
    WHERE id = share_id;
    
    IF target_email = caller_email THEN
        DELETE FROM portfolio_shares WHERE id = share_id;
        RETURN TRUE;
    ELSE
        RAISE EXCEPTION 'Not authorized';
    END IF;
END;
$$ LANGUAGE plpgsql;
    `;
    
    try {
        await client.connect();
        await client.query(sql);
        console.log("RPCs created successfully.");
    } catch (e) {
        console.log(`Failed to execute: ${e.message}`);
    } finally {
        await client.end();
    }
}

run();
