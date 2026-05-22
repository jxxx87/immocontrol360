CREATE OR REPLACE FUNCTION public.debug_simulate_payment(
  p_claim_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_note text,
  p_installment_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id uuid;
  v_inserted_sum numeric;
  v_trigger_sum numeric;
  v_res json;
BEGIN
  -- We just call the actual function but inside a subtransaction? No we can't easily trap deferred triggers.
  -- But we can just execute the logic.
  
  -- Actually, let's just create a payment plan, call the function, and catch the exact error!
  RETURN json_build_object('msg', 'not implemented');
END;
$$;
