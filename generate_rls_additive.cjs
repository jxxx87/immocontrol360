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
        
        let sql = `-- Helper Functions
CREATE OR REPLACE FUNCTION has_portfolio_access(check_portfolio_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM portfolio_shares WHERE portfolio_id = check_portfolio_id AND shared_with_email = (auth.jwt()->>'email') AND status = 'accepted');
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
    RETURN EXISTS (
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
            SELECT c.table_name, string_agg(c.column_name, ',') as cols
            FROM information_schema.columns c
            JOIN information_schema.tables t ON c.table_name = t.table_name AND c.table_schema = t.table_schema
            WHERE c.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
            AND c.table_name NOT IN ('profiles', 'push_subscriptions', 'subscriptions', 'portfolio_shares', 'user_roles')
            GROUP BY c.table_name
            ORDER BY c.table_name
        `);

        for (const row of tablesRes.rows) {
            const table = row.table_name;
            const cols = row.cols.split(',');
            
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

            sql += `DROP POLICY IF EXISTS "shared_users_access" ON ${table};\n`;
            sql += `CREATE POLICY "shared_users_access" ON ${table} FOR ALL USING (${condition}) WITH CHECK (${condition});\n\n`;
        }

        fs.writeFileSync('update_rls_additive.sql', sql);
        console.log("SQL script update_rls_additive.sql generated successfully!");

    } catch (e) {
        console.log(`Failed to execute: ${e.message}`);
    } finally {
        await client.end();
    }
}

run();
