\set ON_ERROR_STOP on
-- ARCHIV (historisch) – NICHT AUSFÜHREN. Ursprung: immo-web/fix_rls.cjs. Siehe immo-web/archive/sql/README.md.
DO $$ BEGIN RAISE EXCEPTION 'Archivdatei - nicht ausfuehren (siehe immo-web/archive/sql/README.md)'; END $$;
-- Aus dem geloeschten Runner-Skript fix_rls.cjs uebernommen (Komplett-Check 2026-11-27). Das Skript hatte dieses SQL
-- direkt per pg auf die Produktiv-DB gespielt (an der Migrationshistorie vorbei). Massgeblich sind Live-Stand und supabase/migrations.

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
