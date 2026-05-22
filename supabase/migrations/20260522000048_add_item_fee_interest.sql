-- Add fee_amount and interest_amount to claim_items
-- Each item knows its own fees and interest
ALTER TABLE claim_items ADD COLUMN IF NOT EXISTS fee_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE claim_items ADD COLUMN IF NOT EXISTS interest_amount numeric(12,2) NOT NULL DEFAULT 0;

-- Disable trigger to fix existing data
ALTER TABLE claim_items DISABLE TRIGGER trigger_protect_claim_item_original_amount;

-- Fix existing "Test" item: set fee/interest from timeline, restore original_amount to total
DO $$
DECLARE
  v_item RECORD;
  v_elem jsonb;
  v_i int;
  v_items_array jsonb;
  v_fee numeric;
  v_interest numeric;
  v_base numeric;
BEGIN
  FOR v_item IN 
    SELECT ci.id as item_id, ci.description, ci.original_amount, ce.event_metadata
    FROM claim_items ci
    JOIN claim_events ce ON ce.claim_id = ci.claim_id 
      AND ce.event_metadata->>'source' IN ('append_advanced', 'create_advanced')
    WHERE ci.item_type != 'rent'
  LOOP
    v_items_array := v_item.event_metadata->'items';
    v_fee := COALESCE((v_item.event_metadata->>'fee_amount')::numeric, 0);
    v_interest := COALESCE((v_item.event_metadata->>'accumulated_interest')::numeric, 0);
    
    IF v_items_array IS NOT NULL AND jsonb_array_length(v_items_array) > 0 THEN
      FOR v_i IN 0..jsonb_array_length(v_items_array)-1 LOOP
        v_elem := v_items_array->v_i;
        IF (v_elem->>'description') = v_item.description THEN
          v_base := (v_elem->>'amount')::numeric;
          -- original_amount should be base + fee + interest
          UPDATE claim_items SET 
            original_amount = v_base + v_fee + v_interest,
            fee_amount = v_fee,
            interest_amount = v_interest
          WHERE id = v_item.item_id;
          RAISE NOTICE 'Fixed % : base=%, fee=%, interest=%, total=%', 
            v_item.description, v_base, v_fee, v_interest, v_base + v_fee + v_interest;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

ALTER TABLE claim_items ENABLE TRIGGER trigger_protect_claim_item_original_amount;
