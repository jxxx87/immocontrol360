-- ============================================================
-- Migration: Investor Portal – Komplettabgleich
-- Datum: 2026-02-13
-- Zweck: Stellt sicher, dass ALLE Spalten existieren,
--         die vom InvestorPortal, Cockpit und Tenants
--         benötigt werden.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. PROPERTIES: Markt-, Investment- und DD-Felder
-- ────────────────────────────────────────────────────────────

-- 1a. Grundfelder (Market Value, Investment, Equity)
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS market_value_total    NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS market_value_per_sqm  NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_investment_cost  NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS equity_invested        NUMERIC DEFAULT 0;

-- 1b. Lage-Score (1-10∕Ampel, ersetzt alte 3-Felder-Struktur)
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS location_score_total INTEGER DEFAULT 5;

-- Alte Lage-Einzelfelder entfernen (falls vorhanden)
ALTER TABLE properties DROP COLUMN IF EXISTS location_infrastructure;
ALTER TABLE properties DROP COLUMN IF EXISTS location_dynamics;
ALTER TABLE properties DROP COLUMN IF EXISTS location_micro;

-- 1c. Due Diligence – Objektzustand (0–5 Stufensystem)
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS dd_condition_exterior   INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_condition_roof        INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_condition_staircase   INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_condition_units       INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_condition_heating     INTEGER DEFAULT 0;

-- 1d. Due Diligence – Energiestand (jetzt INTEGER 0–5, NICHT mehr Boolean)
--     Falls alte Boolean-Spalten existieren, werden sie entfernt
--     und durch neue Integer-Spalten ersetzt.

-- Alte Boolean-Spalten entfernen (aus Migration 20260213140000)
ALTER TABLE properties DROP COLUMN IF EXISTS dd_energy_basement;
ALTER TABLE properties DROP COLUMN IF EXISTS dd_energy_roof;
ALTER TABLE properties DROP COLUMN IF EXISTS dd_energy_heating_system;
-- dd_energy_facade und dd_energy_windows hatten in beiden
-- Migrationen denselben Namen, werden hier nicht gedroppt,
-- sondern nur sichergestellt, dass sie INTEGER sind.

-- Neue Integer-Energiestand-Spalten hinzufügen
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS dd_energy_basement_ceiling INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_energy_attic_roof       INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_energy_facade           INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_energy_windows          INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dd_energy_heating          INTEGER DEFAULT 0;

-- Falls dd_energy_facade oder dd_energy_windows aktuell BOOLEAN sind,
-- muss der Typ geändert werden. Wir versuchen das mit ALTER TYPE:
DO $$
BEGIN
    -- dd_energy_facade: Boolean → Integer
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'properties'
          AND column_name = 'dd_energy_facade'
          AND data_type = 'boolean'
    ) THEN
        ALTER TABLE properties ALTER COLUMN dd_energy_facade TYPE INTEGER USING (CASE WHEN dd_energy_facade THEN 1 ELSE 0 END);
        ALTER TABLE properties ALTER COLUMN dd_energy_facade SET DEFAULT 0;
    END IF;

    -- dd_energy_windows: Boolean → Integer
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'properties'
          AND column_name = 'dd_energy_windows'
          AND data_type = 'boolean'
    ) THEN
        ALTER TABLE properties ALTER COLUMN dd_energy_windows TYPE INTEGER USING (CASE WHEN dd_energy_windows THEN 1 ELSE 0 END);
        ALTER TABLE properties ALTER COLUMN dd_energy_windows SET DEFAULT 0;
    END IF;
END $$;

-- 1e. Steuer-Standards
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS building_share_percent NUMERIC DEFAULT 80,
ADD COLUMN IF NOT EXISTS afa_percent            NUMERIC DEFAULT 2;


-- ────────────────────────────────────────────────────────────
-- 2. UNITS: Finanzfelder für Lease-Sync
-- ────────────────────────────────────────────────────────────
-- Wenn ein Mietvertrag erstellt/geändert wird, werden diese
-- Felder automatisch mit den Vertragswerten überschrieben.

ALTER TABLE units
ADD COLUMN IF NOT EXISTS cold_rent_ist       NUMERIC,
ADD COLUMN IF NOT EXISTS service_charge_soll NUMERIC,
ADD COLUMN IF NOT EXISTS heating_cost_soll   NUMERIC,
ADD COLUMN IF NOT EXISTS other_costs_soll    NUMERIC,
ADD COLUMN IF NOT EXISTS deposit_soll        NUMERIC;


-- ────────────────────────────────────────────────────────────
-- 3. LOANS: Kommentar für erweitertes Label
-- ────────────────────────────────────────────────────────────
COMMENT ON COLUMN loans.bank_name IS 'Bank / Co-Invest / sonstiges Darlehen';


-- ────────────────────────────────────────────────────────────
-- 4. Kommentare zur Dokumentation
-- ────────────────────────────────────────────────────────────
COMMENT ON COLUMN properties.market_value_total       IS 'Marktwert gesamt (€)';
COMMENT ON COLUMN properties.market_value_per_sqm     IS 'Marktwert pro m² (€), automatisch berechnet';
COMMENT ON COLUMN properties.total_investment_cost     IS 'Gesamtinvestition inkl. KNK (€)';
COMMENT ON COLUMN properties.equity_invested           IS 'Eingesetztes Eigenkapital (€)';
COMMENT ON COLUMN properties.location_score_total      IS 'Lage-Score 1–10 (manuell, Ampel: 1-4 rot, 5-7 gelb, 8-10 grün)';

COMMENT ON COLUMN properties.dd_condition_exterior     IS 'DD Objektzustand Außen (0=keine Angabe, 1=Saniert, 2=Gut, 3=OK, 4=Mangel, 5=Defekt)';
COMMENT ON COLUMN properties.dd_condition_roof         IS 'DD Objektzustand Dach';
COMMENT ON COLUMN properties.dd_condition_staircase    IS 'DD Objektzustand Treppenhaus';
COMMENT ON COLUMN properties.dd_condition_units        IS 'DD Objektzustand Wohnungen';
COMMENT ON COLUMN properties.dd_condition_heating      IS 'DD Objektzustand Heizung';

COMMENT ON COLUMN properties.dd_energy_basement_ceiling IS 'DD Energiestand Kellerdecke (0-5 Stufensystem)';
COMMENT ON COLUMN properties.dd_energy_attic_roof       IS 'DD Energiestand Dach/OG (0-5 Stufensystem)';
COMMENT ON COLUMN properties.dd_energy_facade           IS 'DD Energiestand Fassade (0-5 Stufensystem)';
COMMENT ON COLUMN properties.dd_energy_windows          IS 'DD Energiestand Fenster (0-5 Stufensystem)';
COMMENT ON COLUMN properties.dd_energy_heating          IS 'DD Energiestand Heizung (0-5 Stufensystem)';

COMMENT ON COLUMN properties.building_share_percent    IS 'Gebäudeanteil in % (für AfA-Berechnung)';
COMMENT ON COLUMN properties.afa_percent               IS 'AfA-Satz in % (Standard 2%)';

COMMENT ON COLUMN units.cold_rent_ist       IS 'Kaltmiete IST (€) – wird automatisch aus Mietvertrag synchronisiert';
COMMENT ON COLUMN units.service_charge_soll IS 'Nebenkosten (€) – wird automatisch aus Mietvertrag synchronisiert';
COMMENT ON COLUMN units.heating_cost_soll   IS 'Heizkosten (€) – wird automatisch aus Mietvertrag synchronisiert';
COMMENT ON COLUMN units.other_costs_soll    IS 'Sonstige Kosten (€) – wird automatisch aus Mietvertrag synchronisiert';
COMMENT ON COLUMN units.deposit_soll        IS 'Kaution (€) – wird automatisch aus Mietvertrag synchronisiert';
