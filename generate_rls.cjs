const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const projectId = "agsmqvvwfufenaiekuox";
    const connectionString = `postgres://postgres:${password}@db.${projectId}.supabase.co:5432/postgres`;
    
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    try {
        await client.connect();
        
        const res = await client.query(`
            SELECT tbl.relname as table_name, pol.polname, pol.polcmd, pol.polqual, pol.polwithcheck
            FROM pg_policy pol
            JOIN pg_class tbl ON pol.polrelid = tbl.oid
            JOIN pg_namespace nsp ON tbl.relnamespace = nsp.oid
            WHERE nsp.nspname = 'public'
            AND tbl.relname NOT IN ('profiles', 'push_subscriptions', 'subscriptions', 'portfolio_shares', 'user_roles')
            ORDER BY tbl.relname, pol.polname;
        `);
        
        let sql = `-- Helper Functions
CREATE OR REPLACE FUNCTION has_portfolio_access(check_portfolio_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM portfolios WHERE id = check_portfolio_id AND user_id = auth.uid()) 
        OR EXISTS (SELECT 1 FROM portfolio_shares WHERE portfolio_id = check_portfolio_id AND shared_with_email = (auth.jwt()->>'email') AND status = 'accepted');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_property_access(check_property_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN has_portfolio_access((SELECT portfolio_id FROM properties WHERE id = check_property_id));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_unit_access(check_unit_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN has_property_access((SELECT property_id FROM units WHERE id = check_unit_id));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION is_user_shared_with_me(check_user_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN check_user_id = auth.uid() 
        OR EXISTS (
            SELECT 1 FROM portfolio_shares ps 
            JOIN portfolios p ON p.id = ps.portfolio_id 
            WHERE p.user_id = check_user_id 
            AND ps.shared_with_email = (auth.jwt()->>'email') 
            AND ps.status = 'accepted'
        );
END;
$$ LANGUAGE plpgsql;

`;

        const tablesRes = await client.query(`
            SELECT table_name, string_agg(column_name, ',') as cols
            FROM information_schema.columns
            WHERE table_schema = 'public'
            GROUP BY table_name
        `);
        const tableCols = {};
        for (const row of tablesRes.rows) {
            tableCols[row.table_name] = row.cols.split(',');
        }

        for (const pol of res.rows) {
            const table = pol.table_name;
            const cols = tableCols[table] || [];
            
            let condition = "";
            if (cols.includes('portfolio_id')) {
                condition = "has_portfolio_access(portfolio_id)";
            } else if (cols.includes('property_id')) {
                condition = "has_property_access(property_id)";
            } else if (cols.includes('unit_id')) {
                condition = "has_unit_access(unit_id)";
            } else if (cols.includes('user_id')) {
                condition = "is_user_shared_with_me(user_id)";
            } else {
                continue; // Skip tables without any link
            }

            const polcmd = pol.polcmd;
            let cmdStr = "";
            if (polcmd === 'r') cmdStr = "SELECT";
            else if (polcmd === 'a') cmdStr = "INSERT";
            else if (polcmd === 'w') cmdStr = "UPDATE";
            else if (polcmd === 'd') cmdStr = "DELETE";
            else if (polcmd === '*') cmdStr = "ALL";

            sql += `DROP POLICY IF EXISTS "${pol.polname}" ON ${table};\n`;
            
            let usingClause = "";
            let withCheckClause = "";

            if (polcmd === 'a') {
                withCheckClause = `WITH CHECK (${condition})`;
            } else if (polcmd === 'r' || polcmd === 'd') {
                usingClause = `USING (${condition})`;
            } else if (polcmd === 'w') {
                usingClause = `USING (${condition})`;
                withCheckClause = `WITH CHECK (${condition})`;
            } else if (polcmd === '*') {
                usingClause = `USING (${condition})`;
                withCheckClause = `WITH CHECK (${condition})`;
            }

            sql += `CREATE POLICY "${pol.polname}" ON ${table} FOR ${cmdStr} ${usingClause} ${withCheckClause};\n\n`;
        }

        fs.writeFileSync('update_rls.sql', sql);
        console.log("SQL script update_rls.sql generated successfully!");

    } catch (e) {
        console.log(`Failed to execute: ${e.message}`);
    } finally {
        await client.end();
    }
}

run();
