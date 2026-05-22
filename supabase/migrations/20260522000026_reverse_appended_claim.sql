-- ============================================================================
-- Migration: Add reverse_appended_claim RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reverse_appended_claim(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_claim_id uuid;
    v_event_metadata jsonb;
    v_fee_amount numeric;
    v_accumulated_interest numeric;
    v_item record;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    -- Load the event
    SELECT claim_id, event_metadata INTO v_claim_id, v_event_metadata
    FROM claim_events
    WHERE id = p_event_id AND user_id = v_user_id AND event_type = 'note_added' AND event_metadata->>'source' = 'append_advanced'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Das Ereignis wurde nicht gefunden oder ist keine Erweiterung der Akte.';
    END IF;

    v_fee_amount := (v_event_metadata->>'fee_amount')::numeric;
    v_accumulated_interest := (v_event_metadata->>'accumulated_interest')::numeric;

    -- Reduce fees and interest
    UPDATE claims SET
        accumulated_unpaid_fees = GREATEST(0, COALESCE(accumulated_unpaid_fees, 0) - COALESCE(v_fee_amount, 0)),
        accumulated_unpaid_interest = GREATEST(0, COALESCE(accumulated_unpaid_interest, 0) - COALESCE(v_accumulated_interest, 0))
    WHERE id = v_claim_id;

    -- Delete the added claim_items
    -- If it's rent, we have rent_ledger_id in the items array
    -- If it's manual, we match by description and amount (we don't have claim_item_id saved in metadata unfortunately)
    -- Actually, it's safer to delete claim_items created AFTER the event? 
    -- Or just match rent_ledger_id. And for manual, match description.
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_event_metadata->'items')
    LOOP
        IF v_item.value->>'rent_ledger_id' IS NOT NULL THEN
            DELETE FROM claim_items 
            WHERE claim_id = v_claim_id AND rent_ledger_id = (v_item.value->>'rent_ledger_id')::uuid;
        ELSE
            -- Manual item, limit 1 to avoid deleting duplicates
            DELETE FROM claim_items
            WHERE id IN (
                SELECT id FROM claim_items 
                WHERE claim_id = v_claim_id 
                  AND description = v_item.value->>'description' 
                  AND original_amount = (v_item.value->>'amount')::numeric
                  AND rent_ledger_id IS NULL
                LIMIT 1
            );
        END IF;
    END LOOP;

    -- Delete the event
    DELETE FROM claim_events WHERE id = p_event_id;

END;
$$;
