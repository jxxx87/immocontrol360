-- ARCHIV (historisch) – NICHT AUSFÜHREN. Ursprung: immo-web/update_invitations_rpc.cjs. Siehe immo-web/archive/sql/README.md.
DO $$ BEGIN RAISE EXCEPTION 'Archivdatei - nicht ausfuehren (siehe immo-web/archive/sql/README.md)'; END $$;
-- Aus dem geloeschten Runner-Skript update_invitations_rpc.cjs uebernommen (Komplett-Check 2026-11-27). Das Skript hatte dieses SQL
-- direkt per pg auf die Produktiv-DB gespielt (an der Migrationshistorie vorbei). Massgeblich sind Live-Stand und supabase/migrations.

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
