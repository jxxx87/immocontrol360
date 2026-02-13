-- Expand invoices table to support all feature fields
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
ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(10,2) DEFAULT 0;

-- Ensure RLS is active (it should be, but just in case)
-- ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
-- POLICY might already exist for user_id.
