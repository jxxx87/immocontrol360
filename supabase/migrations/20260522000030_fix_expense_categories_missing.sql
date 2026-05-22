-- Fix and seed expense_categories
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

-- Ensure policies are correct
DROP POLICY IF EXISTS "Users can view their own and standard categories" ON expense_categories;
CREATE POLICY "Users can view their own and standard categories" 
ON expense_categories FOR SELECT 
USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert their own categories" ON expense_categories;
CREATE POLICY "Users can insert their own categories" 
ON expense_categories FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own categories" ON expense_categories;
CREATE POLICY "Users can update their own categories" 
ON expense_categories FOR UPDATE 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own categories" ON expense_categories;
CREATE POLICY "Users can delete their own categories" 
ON expense_categories FOR DELETE 
USING (auth.uid() = user_id);

-- Make sure user_id is nullable for system defaults
ALTER TABLE expense_categories ALTER COLUMN user_id DROP NOT NULL;

-- Insert standard categories if they don't exist
DO $$
DECLARE
    key_area uuid;
    key_direct uuid;
    key_persons uuid;
BEGIN
    SELECT id INTO key_area FROM distribution_keys WHERE name = 'Wohnfläche' AND user_id IS NULL LIMIT 1;
    SELECT id INTO key_direct FROM distribution_keys WHERE name = 'Direktzuordnung' AND user_id IS NULL LIMIT 1;
    SELECT id INTO key_persons FROM distribution_keys WHERE name = 'Personenanzahl' AND user_id IS NULL LIMIT 1;

    -- If standard distribution keys are not there, maybe we shouldn't fail, just insert with NULL
    
    INSERT INTO expense_categories (name, is_recoverable, distribution_key_id)
    SELECT * FROM (VALUES
        ('Abgasmessung', true, key_area),
        ('Allgemeinstrom', true, key_area),
        ('Aufzug', true, key_area),
        ('Gartenpflege', true, key_area),
        ('Gebäudereinigung', true, key_area),
        ('Gebäudeversicherung', true, key_area),
        ('Gebäudehaftpflicht', true, key_area),
        ('Gehwegreinigung', true, key_area),
        ('Grundsteuer', true, key_area),
        ('Hauswart', true, key_area),
        ('Schornsteinfeger', true, key_area),
        ('Sonstige Betriebskosten', true, key_area),
        ('Straßenreinigungskosten', true, key_area),
        ('Wartung Feuermelder', true, key_area),
        ('Wiederk. Beitr. Oberflächenwasser', true, key_area),
        ('Wiederk. Beitr. Verkehrsanlagen', true, key_area),
        ('Winterdienstgebühr', true, key_area),
        
        ('Abfallentsorgungsgebühren', true, key_direct),
        ('Heizkosten', true, key_direct),
        ('Heizungswartung', true, key_direct),
        
        ('Entwässerung', true, key_persons),
        ('Kaltwasser', true, key_persons),
        ('Schmutzwasser', true, key_persons)
    ) AS v(name, is_recoverable, distribution_key_id)
    WHERE NOT EXISTS (
        SELECT 1 FROM expense_categories e WHERE e.name = v.name AND e.user_id IS NULL
    );
END $$;
