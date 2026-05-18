-- Deals table for storing Neue Deals calculations
CREATE TABLE IF NOT EXISTS deals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL,
    name TEXT NOT NULL DEFAULT 'Neuer Deal',
    -- Summary fields for quick display
    purchase_price NUMERIC DEFAULT 0,
    total_investment NUMERIC DEFAULT 0,
    cold_rent_ist NUMERIC DEFAULT 0,
    cold_rent_soll NUMERIC DEFAULT 0,
    equity NUMERIC DEFAULT 0,
    loan_total NUMERIC DEFAULT 0,
    -- Full deal data as JSON
    deal_data JSONB NOT NULL DEFAULT '{}',
    scenario_data JSONB NOT NULL DEFAULT '{}',
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own deals" ON deals
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Index
CREATE INDEX idx_deals_user ON deals(user_id);
CREATE INDEX idx_deals_portfolio ON deals(portfolio_id);
