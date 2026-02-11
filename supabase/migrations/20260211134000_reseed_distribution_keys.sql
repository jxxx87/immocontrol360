-- Unlink existing categories from distribution keys to allow deletion
UPDATE expense_categories SET distribution_key_id = NULL;

-- Delete all existing distribution keys
DELETE FROM distribution_keys;

-- Insert standard distribution keys
INSERT INTO distribution_keys (name, calculation_type, description)
VALUES 
    ('Wohnfläche', 'area', 'Verteilung nach Quadratmetern'),
    ('Personenanzahl', 'persons', 'Verteilung nach gemeldeten Personen'),
    ('Verbrauch', 'custom', 'Nach gemessenem Verbrauch (z.B. Zähler)'),
    ('Direktzuordnung', 'direct', 'Direkte Zuordnung zu einer Einheit'),
    ('Miteigentumsanteile', 'mea', 'Verteilung nach MEA');
