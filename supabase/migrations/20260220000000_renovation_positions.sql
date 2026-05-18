-- ============================================================
-- Migration: Sanierungsmanager Positionen
-- Datum: 2026-02-20
-- Zweck: Einführung einer 3. Ebene (Positionen) unterhalb von Untergewerken
--        für detaillierte Kalkulationsvorlagen (Menge, Einheit, Preis).
-- ============================================================

CREATE TABLE IF NOT EXISTS renovation_positions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    subtrade_id UUID NOT NULL REFERENCES renovation_subtrades(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    unit TEXT DEFAULT 'Stk.',   -- Einheit (m², Stk., pauschal, lfm, etc.)
    price NUMERIC DEFAULT 0,    -- Einzelpreis (EP)
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ROW LEVEL SECURITY
ALTER TABLE renovation_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own renovation_positions"
    ON renovation_positions FOR ALL USING (auth.uid() = user_id);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_rp_subtrade ON renovation_positions(subtrade_id);
CREATE INDEX IF NOT EXISTS idx_rp_user ON renovation_positions(user_id);

COMMENT ON TABLE renovation_positions IS 'Benutzer-eigene Positions-Templates für Untergewerke (Ebene 3)';
