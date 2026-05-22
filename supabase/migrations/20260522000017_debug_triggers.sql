CREATE OR REPLACE FUNCTION public.debug_get_triggers()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_res json;
BEGIN
  SELECT json_agg(row_to_json(t)) INTO v_res
  FROM (
    SELECT tgname 
    FROM pg_trigger 
    WHERE tgrelid = 'claim_payment_allocations'::regclass
  ) t;
  RETURN v_res;
END;
$$;
