CREATE OR REPLACE FUNCTION public.debug_get_last_payment()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_res json;
BEGIN
  SELECT json_build_object(
    'payment', row_to_json(p),
    'allocations', (SELECT json_agg(row_to_json(a)) FROM claim_payment_allocations a WHERE a.claim_payment_id = p.id)
  ) INTO v_res
  FROM claim_payments p
  ORDER BY created_at DESC
  LIMIT 1;
  RETURN v_res;
END;
$$;
