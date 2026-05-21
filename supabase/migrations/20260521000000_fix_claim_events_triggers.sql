-- Drop triggers that prevent deletion and updates of claim_events
DROP TRIGGER IF EXISTS block_events_delete ON claim_events;
DROP TRIGGER IF EXISTS trigger_block_claim_events_update ON claim_events;

-- Allow DELETE and UPDATE on claim_events through RLS
DROP POLICY IF EXISTS "Block update events" ON claim_events;
DROP POLICY IF EXISTS "Block delete events" ON claim_events;

CREATE POLICY "Update claim_events" ON claim_events FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Delete claim_events" ON claim_events FOR DELETE USING (auth.uid() = user_id);
