-- 1. Create table portfolio_shares
CREATE TABLE IF NOT EXISTS portfolio_shares (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    shared_with_email TEXT NOT NULL,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' or 'accepted'
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(portfolio_id, shared_with_email)
);

-- Enable RLS
ALTER TABLE portfolio_shares ENABLE ROW LEVEL SECURITY;

-- 2. Create RPC to check if user exists by email (Security Definer)
CREATE OR REPLACE FUNCTION check_user_exists_by_email(check_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM auth.users WHERE email = check_email
    ) INTO user_exists;
    RETURN user_exists;
END;
$$;

-- 3. Create RPC to accept portfolio share
-- When a user accepts, the status becomes 'accepted'
CREATE OR REPLACE FUNCTION accept_portfolio_share(share_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    share_record RECORD;
BEGIN
    -- Find the share for the current user's email
    SELECT * INTO share_record 
    FROM portfolio_shares 
    WHERE id = share_id 
      AND shared_with_email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND status = 'pending';

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Update status
    UPDATE portfolio_shares 
    SET status = 'accepted', updated_at = now()
    WHERE id = share_id;
    
    RETURN TRUE;
END;
$$;

-- 4. Helper function to check access for RLS
CREATE OR REPLACE FUNCTION has_portfolio_access(check_portfolio_id UUID, category TEXT, access_type TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_owner BOOLEAN;
    has_shared_access BOOLEAN;
BEGIN
    -- 1. Check if user is the owner
    SELECT EXISTS (
        SELECT 1 FROM portfolios WHERE id = check_portfolio_id AND user_id = auth.uid()
    ) INTO is_owner;

    IF is_owner THEN
        RETURN TRUE;
    END IF;

    -- 2. Check if user has accepted share and specific permission
    -- category e.g., 'immobilien', access_type e.g. 'read' or 'write'
    -- If access_type is 'read', then 'write' also counts as 'read'
    SELECT EXISTS (
        SELECT 1 
        FROM portfolio_shares 
        WHERE portfolio_id = check_portfolio_id
          AND shared_with_email = (SELECT email FROM auth.users WHERE id = auth.uid())
          AND status = 'accepted'
          AND (
              (access_type = 'read' AND permissions->>category IN ('read', 'write'))
              OR 
              (access_type = 'write' AND permissions->>category = 'write')
          )
    ) INTO has_shared_access;

    RETURN has_shared_access;
END;
$$;

-- 5. RLS Policies for portfolio_shares
DROP POLICY IF EXISTS "Users can view shares they created" ON portfolio_shares;
CREATE POLICY "Users can view shares they created"
    ON portfolio_shares FOR SELECT
    USING (created_by = auth.uid());

DROP POLICY IF EXISTS "Users can view shares targeted to their email" ON portfolio_shares;
CREATE POLICY "Users can view shares targeted to their email"
    ON portfolio_shares FOR SELECT
    USING (shared_with_email = (SELECT email FROM auth.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert shares for their own portfolios" ON portfolio_shares;
CREATE POLICY "Users can insert shares for their own portfolios"
    ON portfolio_shares FOR INSERT
    WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM portfolios WHERE id = portfolio_id AND user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update shares they created" ON portfolio_shares;
CREATE POLICY "Users can update shares they created"
    ON portfolio_shares FOR UPDATE
    USING (created_by = auth.uid());
    
DROP POLICY IF EXISTS "Users can delete shares they created" ON portfolio_shares;
CREATE POLICY "Users can delete shares they created"
    ON portfolio_shares FOR DELETE
    USING (created_by = auth.uid());

-- 6. Update Portfolios RLS
DROP POLICY IF EXISTS "Shared users can view portfolio" ON portfolios;
CREATE POLICY "Shared users can view portfolio"
    ON portfolios FOR SELECT
    USING (
        user_id = auth.uid() 
        OR EXISTS (
            SELECT 1 FROM portfolio_shares 
            WHERE portfolio_id = portfolios.id 
            AND shared_with_email = (SELECT email FROM auth.users WHERE id = auth.uid())
            AND status = 'accepted'
        )
    );
