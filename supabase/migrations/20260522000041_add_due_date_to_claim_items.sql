-- ============================================================================
-- Migration: Add due_date column to claim_items
-- This stores the date from which interest should be calculated per item
-- ============================================================================

ALTER TABLE claim_items ADD COLUMN IF NOT EXISTS due_date date;

-- For existing rent items, set due_date from period_month + 3 days tolerance
UPDATE claim_items 
SET due_date = period_month + INTERVAL '3 days'
WHERE item_type = 'rent' AND period_month IS NOT NULL AND due_date IS NULL;
