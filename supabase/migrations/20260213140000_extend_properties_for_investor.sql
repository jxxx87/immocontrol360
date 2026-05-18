-- Erweitere die Tabelle properties für Marktdaten und Investment-Details
ALTER TABLE properties 
ADD COLUMN IF NOT EXISTS market_value_total NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS market_value_per_sqm NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_investment_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS equity_invested NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS location_infrastructure INTEGER DEFAULT 3, -- 1 bis 5
ADD COLUMN IF NOT EXISTS location_dynamics INTEGER DEFAULT 3,       -- 1 bis 5
ADD COLUMN IF NOT EXISTS location_micro INTEGER DEFAULT 3,         -- 1 bis 5
ADD COLUMN IF NOT EXISTS building_share_percent NUMERIC DEFAULT 80,
ADD COLUMN IF NOT EXISTS afa_percent NUMERIC DEFAULT 2;

-- Erweitere Due Diligence Felder (Zustandsbewertung)
ALTER TABLE properties 
ADD COLUMN IF NOT EXISTS dd_condition_exterior INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_condition_roof INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_condition_staircase INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_condition_units INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_condition_heating INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_energy_basement BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS dd_energy_roof BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS dd_energy_facade BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS dd_energy_windows BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS dd_energy_heating_system BOOLEAN DEFAULT false;

-- Kommentar zur Spaltenbenennung in loans
COMMENT ON COLUMN loans.bank_name IS 'Label: Bank / Co-Invest / Sonstiges Darlehen';
