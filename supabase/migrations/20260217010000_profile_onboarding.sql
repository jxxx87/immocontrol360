-- Add portfolio_name and ownership_percent to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS portfolio_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ownership_percent NUMERIC;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT FALSE;

-- Add is_primary flag to portfolios (primary portfolio cannot be deleted)
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE;
