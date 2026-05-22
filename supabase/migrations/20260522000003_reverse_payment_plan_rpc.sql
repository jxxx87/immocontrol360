-- ============================================================================
-- RPC: reverse_payment_plan
-- Reverses an active payment plan and its installments.
-- ============================================================================

-- Drop delete protections since user wants to physically delete plans upon cancellation
DROP TRIGGER IF EXISTS block_payment_plans_delete ON payment_plans;
DROP TRIGGER IF EXISTS block_installments_delete ON payment_plan_installments;

CREATE OR REPLACE FUNCTION public.reverse_payment_plan(p_claim_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_plan_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Check if there is an active payment plan for this claim
  SELECT id INTO v_plan_id
  FROM payment_plans
  WHERE claim_id = p_claim_id AND user_id = v_user_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kein aktiver Ratenplan für diese Forderung gefunden.';
  END IF;

  -- 2. Delete the installments
  DELETE FROM payment_plan_installments WHERE payment_plan_id = v_plan_id;

  -- 3. Delete the plan itself
  DELETE FROM payment_plans WHERE id = v_plan_id;

  -- 4. Set the claim status back to open (if it was payment_plan_active)
  UPDATE claims SET
    status = CASE WHEN status = 'payment_plan_active' THEN 'open' ELSE status END,
    next_action_at = NULL, -- Or we can just leave it or reset it, NULL is safe to clear the immediate warning
    updated_at = now()
  WHERE id = p_claim_id;

END;
$$;
