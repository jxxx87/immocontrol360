-- Add ownership_share (MEA) to units table
ALTER TABLE units ADD COLUMN IF NOT EXISTS ownership_share NUMERIC DEFAULT 0;

-- Update distribution_keys table to include 'mea' type if checking constraints (but we used TEXT)
-- No constraint check needed if we didn't add one.

-- Add 'Miteigentumsanteile' to distribution_keys if not exists
INSERT INTO distribution_keys (name, calculation_type, description) VALUES
('Miteigentumsanteile', 'mea', 'Verteilung nach Miteigentumsanteilen (MEA)')
ON CONFLICT DO NOTHING;

-- Also update 'Wohneinheit' to replace 'Einheit' if we want clean naming, 
-- but might disrupt existing. Standard keys were seeded in code or migration?
-- Migration 20260211102438 inserted keys.
-- Let's update 'Wohneinheit' if 'Einheit' exists or just add it.
-- The previous migration had: ('Wohneinheit', 'units', ...)
-- So 'Wohneinheit' should be fine.
