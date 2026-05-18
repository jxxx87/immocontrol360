-- Add deal_type column to distinguish between Buy & Hold and Fix & Flip deals
ALTER TABLE deals ADD COLUMN IF NOT EXISTS deal_type TEXT NOT NULL DEFAULT 'buy_hold';

-- Index for filtering by deal type
CREATE INDEX IF NOT EXISTS idx_deals_type ON deals(deal_type);
