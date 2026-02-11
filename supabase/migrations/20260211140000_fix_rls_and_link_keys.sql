-- Enable RLS on distribution_keys
ALTER TABLE distribution_keys ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own keys and standard keys" ON distribution_keys;
DROP POLICY IF EXISTS "Users can insert their own keys" ON distribution_keys;
DROP POLICY IF EXISTS "Users can update their own keys" ON distribution_keys;
DROP POLICY IF EXISTS "Users can delete their own keys" ON distribution_keys;

-- Create Policies
CREATE POLICY "Users can view their own keys and standard keys" 
ON distribution_keys FOR SELECT 
USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert their own keys" 
ON distribution_keys FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own keys" 
ON distribution_keys FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own keys" 
ON distribution_keys FOR DELETE 
USING (auth.uid() = user_id);

-- Auto-link Expense Categories to Standard Keys
-- Wohnfläche
UPDATE expense_categories 
SET distribution_key_id = (SELECT id FROM distribution_keys WHERE name = 'Wohnfläche' AND user_id IS NULL LIMIT 1)
WHERE name IN (
    'Abgasmessung', 
    'Allgemeinstrom', 
    'Aufzug', 
    'Gartenpflege', 
    'Gebäudereinigung', 
    'Gebäudeversicherung', 
    'Gebäudehaftpflicht', 
    'Gehwegreinigung', 
    'Grundsteuer', 
    'Hauswart', 
    'Schornsteinfeger', 
    'Sonstige Betriebskosten', 
    'Straßenreinigungskosten', 
    'Wartung Feuermelder', 
    'Wiederk. Beitr. Oberflächenwasser', 
    'Wiederk. Beitr. Verkehrsanlagen', 
    'Winterdienstgebühr'
) AND distribution_key_id IS NULL;

-- Direktzuordnung
UPDATE expense_categories 
SET distribution_key_id = (SELECT id FROM distribution_keys WHERE name = 'Direktzuordnung' AND user_id IS NULL LIMIT 1)
WHERE name IN (
    'Abfallentsorgungsgebühren', 
    'Heizkosten', 
    'Heizungswartung'
) AND distribution_key_id IS NULL;

-- Personenanzahl
UPDATE expense_categories 
SET distribution_key_id = (SELECT id FROM distribution_keys WHERE name = 'Personenanzahl' AND user_id IS NULL LIMIT 1)
WHERE name IN (
    'Entwässerung', 
    'Kaltwasser', 
    'Schmutzwasser'
) AND distribution_key_id IS NULL;
