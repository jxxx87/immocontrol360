-- Erweitere die Tabelle properties für Marktdaten und Investment-Details
ALTER TABLE properties 
ADD COLUMN IF NOT EXISTS market_value_total NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS market_value_per_sqm NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_investment_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS equity_invested NUMERIC DEFAULT 0,
-- Lage Score (manuell auszufüllen, 1-10 Skala für Ampelsystem)
ADD COLUMN IF NOT EXISTS location_score_total INTEGER DEFAULT 5, 
-- Due Diligence: Objektzustand (Stufensystem 0-5)
ADD COLUMN IF NOT EXISTS dd_condition_exterior INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_condition_roof INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_condition_staircase INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_condition_units INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_condition_heating INTEGER DEFAULT 0,
-- Due Diligence: Energiestand (Boolean oder Stufensystem 0-5)
ADD COLUMN IF NOT EXISTS dd_energy_basement_ceiling INTEGER DEFAULT 0, -- Unterste Geschossdecke
ADD COLUMN IF NOT EXISTS dd_energy_attic_roof INTEGER DEFAULT 0,      -- Oberste Geschossdecke/Dach
ADD COLUMN IF NOT EXISTS dd_energy_facade INTEGER DEFAULT 0,          -- Fassade
ADD COLUMN IF NOT EXISTS dd_energy_windows INTEGER DEFAULT 0,         -- Fenster
ADD COLUMN IF NOT EXISTS dd_energy_heating INTEGER DEFAULT 0,         -- Heizung (Energetisch)
-- Steuer-Standards
ADD COLUMN IF NOT EXISTS building_share_percent NUMERIC DEFAULT 80,
ADD COLUMN IF NOT EXISTS afa_percent NUMERIC DEFAULT 2;

-- Kommentar zur Spaltenbenennung in loans für das neue Label
COMMENT ON COLUMN loans.bank_name IS 'Bank / Co-Invest / sonstiges Darlehen';
