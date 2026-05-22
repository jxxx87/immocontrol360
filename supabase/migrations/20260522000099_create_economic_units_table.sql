-- ============================================================================
-- Migration: Create economic_units table for WE-level financial data
-- and add economic_unit_id to loans table
-- ============================================================================

-- 1. Create economic_units table
CREATE TABLE IF NOT EXISTS economic_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    name TEXT,
    total_investment_cost NUMERIC DEFAULT 0,
    equity_invested NUMERIC DEFAULT 0,
    market_value_total NUMERIC DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE economic_units ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies
CREATE POLICY "Users can view their own economic units"
    ON economic_units FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own economic units"
    ON economic_units FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own economic units"
    ON economic_units FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own economic units"
    ON economic_units FOR DELETE USING (auth.uid() = user_id);

-- 4. Add economic_unit_id to loans
ALTER TABLE loans ADD COLUMN IF NOT EXISTS economic_unit_id UUID;

-- 5. Auto-create economic_units rows for existing property groups
-- For every unique economic_unit_id in properties, create a row in economic_units
INSERT INTO economic_units (id, user_id, name)
SELECT DISTINCT 
    p.economic_unit_id, 
    (SELECT u.id FROM auth.users u LIMIT 1),
    'Wirtschaftseinheit'
FROM properties p
WHERE p.economic_unit_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;
