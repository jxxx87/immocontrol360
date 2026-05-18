-- ============================================================
-- Migration: Sanierungsrechner
-- Datum: 2026-02-19
-- Zweck: Tabellen für Kalkulationen (Kostenberechnung)
-- ============================================================

-- 1. KALKULATIONEN (Haupttabelle)
CREATE TABLE IF NOT EXISTS renovation_calculations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    calc_type TEXT NOT NULL DEFAULT 'buy_and_hold'
        CHECK (calc_type IN ('buy_and_hold', 'fix_and_flip')),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'final')),
    building_config JSONB DEFAULT '{}'::jsonb,
    total_cost NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. GEWERKE PRO KALKULATION
CREATE TABLE IF NOT EXISTS renovation_calc_trades (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    calculation_id UUID NOT NULL REFERENCES renovation_calculations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. UNTERGEWERKE PRO KALKULATIONS-GEWERK
CREATE TABLE IF NOT EXISTS renovation_calc_subtrades (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    calc_trade_id UUID NOT NULL REFERENCES renovation_calc_trades(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quantity NUMERIC DEFAULT 0,       -- Menge
    unit_label TEXT DEFAULT 'Stk.',   -- Einheit (m², Stk., pauschal, lfm)
    unit_price NUMERIC DEFAULT 0,     -- Einzelpreis (EP)
    total_price NUMERIC DEFAULT 0,    -- Gesamtpreis (GP) = quantity * unit_price
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- UPDATED_AT TRIGGER
DO $$
BEGIN
    EXECUTE 'DROP TRIGGER IF EXISTS set_updated_at ON renovation_calculations;
             CREATE TRIGGER set_updated_at BEFORE UPDATE ON renovation_calculations
             FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();';
END $$;

-- ROW LEVEL SECURITY
ALTER TABLE renovation_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE renovation_calc_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE renovation_calc_subtrades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own renovation_calculations"
    ON renovation_calculations FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own renovation_calc_trades"
    ON renovation_calc_trades FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own renovation_calc_subtrades"
    ON renovation_calc_subtrades FOR ALL USING (auth.uid() = user_id);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_rc_user ON renovation_calculations(user_id);
CREATE INDEX IF NOT EXISTS idx_rct_calc ON renovation_calc_trades(calculation_id);
CREATE INDEX IF NOT EXISTS idx_rcs_trade ON renovation_calc_subtrades(calc_trade_id);

-- Add default fields to subtrade templates
ALTER TABLE renovation_subtrades
    ADD COLUMN IF NOT EXISTS default_quantity NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS default_unit_label TEXT DEFAULT 'Stk.',
    ADD COLUMN IF NOT EXISTS default_unit_price NUMERIC DEFAULT 0;

COMMENT ON TABLE renovation_calculations IS 'Sanierungsrechner – Kostenkalkulation';
COMMENT ON TABLE renovation_calc_trades IS 'Gewerke einer Kalkulation';
COMMENT ON TABLE renovation_calc_subtrades IS 'Untergewerke einer Kalkulation mit Menge, EP, GP';
