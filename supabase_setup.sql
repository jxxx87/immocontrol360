-- Führen Sie diesen SQL-Code im Supabase SQL Editor aus, um die fehlenden Spalten zu erstellen.

-- 1. Neue Spalten zur Tabelle 'invoices' hinzufügen
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id),
ADD COLUMN IF NOT EXISTS move_in DATE,
ADD COLUMN IF NOT EXISTS move_out DATE,
ADD COLUMN IF NOT EXISTS persons INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS positions JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS sender_name TEXT,
ADD COLUMN IF NOT EXISTS sender_street TEXT,
ADD COLUMN IF NOT EXISTS sender_zip TEXT,
ADD COLUMN IF NOT EXISTS sender_city TEXT,
ADD COLUMN IF NOT EXISTS recipient_name TEXT,
ADD COLUMN IF NOT EXISTS recipient_street TEXT,
ADD COLUMN IF NOT EXISTS recipient_zip TEXT,
ADD COLUMN IF NOT EXISTS recipient_city TEXT,
ADD COLUMN IF NOT EXISTS net_amount NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(10,2) DEFAULT 0;

-- 2. Spalte 'is_vacation_rental' zur Tabelle 'units' hinzufügen (falls noch nicht vorhanden)
ALTER TABLE units 
ADD COLUMN IF NOT EXISTS is_vacation_rental BOOLEAN DEFAULT false;

-- 3. Cache aktualisieren (passiert meist automatisch, aber zur Sicherheit)
NOTIFY pgrst, 'reload schema';
