CREATE OR REPLACE FUNCTION get_properties_policies()
RETURNS TABLE(policyname text, cmd text, qual text, with_check text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'properties';
$$;
