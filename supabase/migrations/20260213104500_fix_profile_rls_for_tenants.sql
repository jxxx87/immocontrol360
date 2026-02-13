-- Allow tenants to read the profile settings of their property owners
-- This is necessary for the Topbar to display opening hours
CREATE POLICY "Tenants can view owner profile settings" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM portfolios p
      JOIN properties prop ON prop.portfolio_id = p.id
      JOIN user_roles ur ON ur.property_id = prop.id
      WHERE p.user_id = profiles.id 
      AND ur.user_id = auth.uid()
    )
  );
