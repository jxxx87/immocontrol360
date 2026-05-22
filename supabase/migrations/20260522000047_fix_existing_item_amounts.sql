-- Fix existing data: Remove fees/interest incorrectly baked into original_amount
-- Must temporarily disable the protection trigger since payments exist

-- Disable the trigger
ALTER TABLE claim_items DISABLE TRIGGER trigger_protect_claim_item_original_amount;

DO $$
DECLARE
  v_item RECORD;
  v_items_array jsonb;
  v_elem jsonb;
  v_correct_amount numeric;
  v_i int;
BEGIN
  FOR v_item IN 
    SELECT ci.id as item_id, ci.description, ci.original_amount, ci.claim_id,
           ce.event_metadata
    FROM claim_items ci
    JOIN claim_events ce ON ce.claim_id = ci.claim_id 
      AND ce.event_metadata->>'source' IN ('append_advanced', 'create_advanced')
    WHERE ci.item_type != 'rent'
  LOOP
    v_items_array := v_item.event_metadata->'items';
    IF v_items_array IS NOT NULL AND jsonb_array_length(v_items_array) > 0 THEN
      FOR v_i IN 0..jsonb_array_length(v_items_array)-1
      LOOP
        v_elem := v_items_array->v_i;
        IF (v_elem->>'description') = v_item.description THEN
          v_correct_amount := (v_elem->>'amount')::numeric;
          IF v_correct_amount IS NOT NULL AND v_correct_amount != v_item.original_amount THEN
            RAISE NOTICE 'Fixing item % (%) from % to %', v_item.item_id, v_item.description, v_item.original_amount, v_correct_amount;
            UPDATE claim_items SET original_amount = v_correct_amount WHERE id = v_item.item_id;
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- Re-enable the trigger
ALTER TABLE claim_items ENABLE TRIGGER trigger_protect_claim_item_original_amount;
