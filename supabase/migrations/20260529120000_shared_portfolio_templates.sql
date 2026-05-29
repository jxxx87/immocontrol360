-- Cleanup duplicates before creating unique index
DELETE FROM document_templates a USING (
    SELECT MIN(ctid) as keep_ctid, portfolio_id, type
    FROM document_templates
    WHERE portfolio_id IS NOT NULL
    GROUP BY portfolio_id, type
    HAVING COUNT(*) > 1
) b
WHERE a.portfolio_id = b.portfolio_id 
  AND a.type = b.type 
  AND a.ctid <> b.keep_ctid;

-- 1. Drop existing unique constraint
ALTER TABLE document_templates DROP CONSTRAINT IF EXISTS unique_user_portfolio_type;

-- 2. Create partial unique indexes to support shared portfolio templates and global user templates
DROP INDEX IF EXISTS unique_portfolio_type_template;
CREATE UNIQUE INDEX unique_portfolio_type_template 
ON document_templates (portfolio_id, type) 
WHERE portfolio_id IS NOT NULL;

DROP INDEX IF EXISTS unique_user_type_template;
CREATE UNIQUE INDEX unique_user_type_template 
ON document_templates (user_id, type) 
WHERE portfolio_id IS NULL;

-- 3. Create helper function for RLS
CREATE OR REPLACE FUNCTION has_document_template_access(tpl_portfolio_id UUID, tpl_user_id UUID) 
RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    -- If it's the template owner, allow
    IF tpl_user_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    -- If it's a portfolio template, check portfolio access
    IF tpl_portfolio_id IS NOT NULL THEN
        -- Check if current user is owner of the portfolio
        IF EXISTS (SELECT 1 FROM portfolios WHERE id = tpl_portfolio_id AND user_id = auth.uid()) THEN
            RETURN TRUE;
        END IF;
        -- Check if current user has shared access
        IF EXISTS (SELECT 1 FROM portfolio_shares WHERE portfolio_id = tpl_portfolio_id AND shared_with_email = (auth.jwt()->>'email') AND status = 'accepted') THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- 4. Drop and recreate RLS policies
DROP POLICY IF EXISTS "Users can manage their own templates" ON document_templates;
DROP POLICY IF EXISTS "shared_users_access" ON document_templates;
DROP POLICY IF EXISTS "shared_users_select" ON document_templates;
DROP POLICY IF EXISTS "shared_users_insert" ON document_templates;
DROP POLICY IF EXISTS "shared_users_update" ON document_templates;
DROP POLICY IF EXISTS "shared_users_delete" ON document_templates;
DROP POLICY IF EXISTS "manage_document_template_policy" ON document_templates;

-- Define a single unified policy for all operations using the helper function
CREATE POLICY "manage_document_template_policy" ON document_templates 
FOR ALL 
USING (has_document_template_access(portfolio_id, user_id)) 
WITH CHECK (has_document_template_access(portfolio_id, user_id));
