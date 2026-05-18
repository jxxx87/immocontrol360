-- Add lease_type column to leases table
-- Values: 'normal' (Normalmietvertrag), 'staffel' (Staffelmietvertrag), 'index' (Indexmietvertrag)
ALTER TABLE leases ADD COLUMN IF NOT EXISTS lease_type TEXT DEFAULT 'normal';
