-- Add new fields to units table
ALTER TABLE units 
ADD COLUMN IF NOT EXISTS cold_rent_ist NUMERIC,
ADD COLUMN IF NOT EXISTS service_charge_soll NUMERIC,
ADD COLUMN IF NOT EXISTS heating_cost_soll NUMERIC,
ADD COLUMN IF NOT EXISTS other_costs_soll NUMERIC,
ADD COLUMN IF NOT EXISTS deposit_soll NUMERIC;
