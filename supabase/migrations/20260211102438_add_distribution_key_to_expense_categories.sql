-- Create table for distribution keys
CREATE TABLE IF NOT EXISTS distribution_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    calculation_type TEXT NOT NULL DEFAULT 'area', -- 'area', 'persons', 'units', 'equal', 'custom'
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default keys for existing users (via a temporary function or just assume logic handles initial seed)
-- Since we can't easily seed for all users here without complex logic, we'll rely on frontend to auto-seed or handle empty.
-- Actually, let's just make 'user_id' nullable for global defaults or use RLS. 
-- Better: user_id is null for system defaults.

ALTER TABLE distribution_keys ALTER COLUMN user_id DROP NOT NULL;

-- Insert global defaults
INSERT INTO distribution_keys (name, calculation_type, description) VALUES
('Wohnfläche', 'area', 'Verteilung nach Quadratmetern'),
('Personenanzahl', 'persons', 'Verteilung nach gemeldeten Personen'),
('Wohneinheit', 'units', 'Verteilung pro Einheit'),
('Gleicher Anteil', 'equal', 'Jeder zahlt gleich viel'),
('Verbrauch', 'custom', 'Nach gemessenem Verbrauch (z.B. Zähler)')
ON CONFLICT DO NOTHING; -- No unique constraint on name yet, but good practice if we added one.

-- Modify expense_categories to link to distribution_keys
ALTER TABLE expense_categories 
ADD COLUMN IF NOT EXISTS distribution_key_id UUID REFERENCES distribution_keys(id) ON DELETE SET NULL;

-- Remove old column if it exists (from previous attempts)
ALTER TABLE expense_categories DROP COLUMN IF EXISTS distribution_key;
