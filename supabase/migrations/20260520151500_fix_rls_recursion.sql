-- Fix infinite recursion between user_roles and properties

-- 1. Create a SECURITY DEFINER function to bypass RLS and break the cycle
CREATE OR REPLACE FUNCTION get_investor_properties(uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM properties WHERE user_id = uid;
$$;

-- 2. Drop the recursive policy on user_roles
DROP POLICY IF EXISTS "investors_manage_own_roles" ON user_roles;

-- 3. Create the new policy using the function
CREATE POLICY "investors_manage_own_roles" ON user_roles
    FOR ALL USING (
        property_id IN ( SELECT get_investor_properties(auth.uid()) ) OR user_id = auth.uid()
    );
