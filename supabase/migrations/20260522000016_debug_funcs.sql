CREATE OR REPLACE FUNCTION public.debug_get_functions()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_res json;
BEGIN
  SELECT json_agg(row_to_json(t)) INTO v_res
  FROM (
    SELECT proname, pg_get_function_identity_arguments(oid) as args 
    FROM pg_proc 
    WHERE proname = 'record_claim_payment'
  ) t;
  RETURN v_res;
END;
$$;
