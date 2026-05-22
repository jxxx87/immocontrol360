-- ============================================================================
-- Migration: Override block functions to allow deletes
-- ============================================================================

CREATE OR REPLACE FUNCTION block_physical_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- We allow deletes now, so just return OLD.
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION block_claim_events_modification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- We allow deletes and modifications now, so just return OLD or NEW.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
