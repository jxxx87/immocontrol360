-- Add is_active column to claim_access_links
ALTER TABLE claim_access_links ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Ensure all existing links with no revoked_at are active
UPDATE claim_access_links SET is_active = true WHERE revoked_at IS NULL;
UPDATE claim_access_links SET is_active = false WHERE revoked_at IS NOT NULL;
