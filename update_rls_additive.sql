-- Helper Functions
CREATE OR REPLACE FUNCTION has_portfolio_access(check_portfolio_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM portfolio_shares WHERE portfolio_id = check_portfolio_id AND shared_with_email = (auth.jwt()->>'email') AND status = 'accepted');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_property_access(check_property_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN has_portfolio_access((SELECT portfolio_id FROM properties WHERE id = check_property_id));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_unit_access(check_unit_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN has_property_access((SELECT property_id FROM units WHERE id = check_unit_id));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION is_user_shared_with_me(check_user_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM portfolio_shares ps 
        JOIN portfolios p ON p.id = ps.portfolio_id 
        WHERE p.user_id = check_user_id 
        AND ps.shared_with_email = (auth.jwt()->>'email') 
        AND ps.status = 'accepted'
    );
END;
$$ LANGUAGE plpgsql;

DROP POLICY IF EXISTS "shared_users_access" ON announcements;
CREATE POLICY "shared_users_access" ON announcements FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON claim_events;
CREATE POLICY "shared_users_access" ON claim_events FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON claim_items;
CREATE POLICY "shared_users_access" ON claim_items FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON claim_payment_allocations;
CREATE POLICY "shared_users_access" ON claim_payment_allocations FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON claim_payments;
CREATE POLICY "shared_users_access" ON claim_payments FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON claims;
CREATE POLICY "shared_users_access" ON claims FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON contacts;
CREATE POLICY "shared_users_access" ON contacts FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON deals;
CREATE POLICY "shared_users_access" ON deals FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON distribution_keys;
CREATE POLICY "shared_users_access" ON distribution_keys FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON documents;
CREATE POLICY "shared_users_access" ON documents FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON economic_units;
CREATE POLICY "shared_users_access" ON economic_units FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON expense_categories;
CREATE POLICY "shared_users_access" ON expense_categories FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON expenses;
CREATE POLICY "shared_users_access" ON expenses FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON floor_plans;
CREATE POLICY "shared_users_access" ON floor_plans FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON invoice_counters;
CREATE POLICY "shared_users_access" ON invoice_counters FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON invoice_items;
CREATE POLICY "shared_users_access" ON invoice_items FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON invoices;
CREATE POLICY "shared_users_access" ON invoices FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON leases;
CREATE POLICY "shared_users_access" ON leases FOR ALL USING (has_unit_access(unit_id)) WITH CHECK (has_unit_access(unit_id));

DROP POLICY IF EXISTS "shared_users_access" ON loans;
CREATE POLICY "shared_users_access" ON loans FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON meter_readings;
CREATE POLICY "shared_users_access" ON meter_readings FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON meters;
CREATE POLICY "shared_users_access" ON meters FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON objektkalender_events;
CREATE POLICY "shared_users_access" ON objektkalender_events FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON objektkalender_history;
CREATE POLICY "shared_users_access" ON objektkalender_history FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON objektkalender_settings;
CREATE POLICY "shared_users_access" ON objektkalender_settings FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON payment_plan_installments;
CREATE POLICY "shared_users_access" ON payment_plan_installments FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON payment_plans;
CREATE POLICY "shared_users_access" ON payment_plans FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON pdf_templates;
CREATE POLICY "shared_users_access" ON pdf_templates FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON portfolios;
CREATE POLICY "shared_users_access" ON portfolios FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON properties;
CREATE POLICY "shared_users_access" ON properties FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_calc_subtrades;
CREATE POLICY "shared_users_access" ON renovation_calc_subtrades FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_calc_trades;
CREATE POLICY "shared_users_access" ON renovation_calc_trades FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_calculations;
CREATE POLICY "shared_users_access" ON renovation_calculations FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_invoices;
CREATE POLICY "shared_users_access" ON renovation_invoices FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_milestone_templates;
CREATE POLICY "shared_users_access" ON renovation_milestone_templates FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_milestones;
CREATE POLICY "shared_users_access" ON renovation_milestones FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_positions;
CREATE POLICY "shared_users_access" ON renovation_positions FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_project_subtrades;
CREATE POLICY "shared_users_access" ON renovation_project_subtrades FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_project_trades;
CREATE POLICY "shared_users_access" ON renovation_project_trades FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_projects;
CREATE POLICY "shared_users_access" ON renovation_projects FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_subtrades;
CREATE POLICY "shared_users_access" ON renovation_subtrades FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_tasks;
CREATE POLICY "shared_users_access" ON renovation_tasks FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_trades;
CREATE POLICY "shared_users_access" ON renovation_trades FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON rent_charges;
CREATE POLICY "shared_users_access" ON rent_charges FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON rent_ledger;
CREATE POLICY "shared_users_access" ON rent_ledger FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON rent_payments;
CREATE POLICY "shared_users_access" ON rent_payments FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON tenant_invitations;
CREATE POLICY "shared_users_access" ON tenant_invitations FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON tenants;
CREATE POLICY "shared_users_access" ON tenants FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON tickets;
CREATE POLICY "shared_users_access" ON tickets FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON units;
CREATE POLICY "shared_users_access" ON units FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON utility_settlements;
CREATE POLICY "shared_users_access" ON utility_settlements FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

