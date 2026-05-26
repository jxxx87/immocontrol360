-- Helper Functions for Portfolio-level Row-Level Security (RLS)
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

CREATE OR REPLACE FUNCTION has_lease_access(check_lease_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM leases l
        JOIN units u ON l.unit_id = u.id
        JOIN properties p ON u.property_id = p.id
        WHERE l.id = check_lease_id
        AND has_portfolio_access(p.portfolio_id)
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_claim_columns_access(check_lease_id UUID, check_tenant_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    IF check_lease_id IS NOT NULL THEN
        RETURN EXISTS (
            SELECT 1 FROM leases l
            JOIN units u ON l.unit_id = u.id
            JOIN properties p ON u.property_id = p.id
            WHERE l.id = check_lease_id
            AND has_portfolio_access(p.portfolio_id)
        );
    END IF;
    
    IF check_tenant_id IS NOT NULL THEN
        RETURN EXISTS (
            SELECT 1 FROM leases l
            JOIN units u ON l.unit_id = u.id
            JOIN properties p ON u.property_id = p.id
            WHERE l.tenant_id = check_tenant_id
            AND has_portfolio_access(p.portfolio_id)
        );
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_claim_access(check_claim_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
DECLARE
    c_lease_id UUID;
    c_tenant_id UUID;
BEGIN
    SELECT lease_id, tenant_id INTO c_lease_id, c_tenant_id FROM claims WHERE id = check_claim_id;
    RETURN has_claim_columns_access(c_lease_id, c_tenant_id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_tenant_access(check_tenant_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM leases l
        JOIN units u ON l.unit_id = u.id
        JOIN properties p ON u.property_id = p.id
        WHERE l.tenant_id = check_tenant_id
        AND has_portfolio_access(p.portfolio_id)
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_economic_unit_access(check_economic_unit_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM properties p
        WHERE p.economic_unit_id = check_economic_unit_id
        AND has_portfolio_access(p.portfolio_id)
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_invoice_access(check_invoice_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM invoices i
        WHERE i.id = check_invoice_id
        AND has_portfolio_access(i.portfolio_id)
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_renovation_calculation_access(check_calc_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM renovation_calculations c
        WHERE c.id = check_calc_id
        AND has_property_access(c.property_id)
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_renovation_calc_trade_access(check_trade_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM renovation_calc_trades t
        WHERE t.id = check_trade_id
        AND has_renovation_calculation_access(t.calculation_id)
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_renovation_project_access(check_project_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM renovation_projects p
        WHERE p.id = check_project_id
        AND has_property_access(p.property_id)
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_renovation_project_trade_access(check_trade_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM renovation_project_trades t
        WHERE t.id = check_trade_id
        AND has_renovation_project_access(t.project_id)
    );
END;
$$ LANGUAGE plpgsql;

DROP POLICY IF EXISTS "shared_users_access" ON announcements;
DROP POLICY IF EXISTS "shared_users_select" ON announcements;
DROP POLICY IF EXISTS "shared_users_insert" ON announcements;
DROP POLICY IF EXISTS "shared_users_update" ON announcements;
DROP POLICY IF EXISTS "shared_users_delete" ON announcements;
CREATE POLICY "shared_users_access" ON announcements FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON claim_events;
DROP POLICY IF EXISTS "shared_users_select" ON claim_events;
DROP POLICY IF EXISTS "shared_users_insert" ON claim_events;
DROP POLICY IF EXISTS "shared_users_update" ON claim_events;
DROP POLICY IF EXISTS "shared_users_delete" ON claim_events;
CREATE POLICY "shared_users_select" ON claim_events FOR SELECT USING (has_claim_access(claim_id));
CREATE POLICY "shared_users_insert" ON claim_events FOR INSERT WITH CHECK (has_claim_access(claim_id));
CREATE POLICY "shared_users_update" ON claim_events FOR UPDATE USING (has_claim_access(claim_id)) WITH CHECK (has_claim_access(claim_id));
CREATE POLICY "shared_users_delete" ON claim_events FOR DELETE USING (has_claim_access(claim_id));

DROP POLICY IF EXISTS "shared_users_access" ON claim_items;
DROP POLICY IF EXISTS "shared_users_select" ON claim_items;
DROP POLICY IF EXISTS "shared_users_insert" ON claim_items;
DROP POLICY IF EXISTS "shared_users_update" ON claim_items;
DROP POLICY IF EXISTS "shared_users_delete" ON claim_items;
CREATE POLICY "shared_users_select" ON claim_items FOR SELECT USING (has_claim_access(claim_id));
CREATE POLICY "shared_users_insert" ON claim_items FOR INSERT WITH CHECK (has_claim_access(claim_id));
CREATE POLICY "shared_users_update" ON claim_items FOR UPDATE USING (has_claim_access(claim_id)) WITH CHECK (has_claim_access(claim_id));
CREATE POLICY "shared_users_delete" ON claim_items FOR DELETE USING (has_claim_access(claim_id));

DROP POLICY IF EXISTS "shared_users_access" ON claim_payment_allocations;
DROP POLICY IF EXISTS "shared_users_select" ON claim_payment_allocations;
DROP POLICY IF EXISTS "shared_users_insert" ON claim_payment_allocations;
DROP POLICY IF EXISTS "shared_users_update" ON claim_payment_allocations;
DROP POLICY IF EXISTS "shared_users_delete" ON claim_payment_allocations;
CREATE POLICY "shared_users_select" ON claim_payment_allocations FOR SELECT USING (has_claim_access(claim_id));
CREATE POLICY "shared_users_insert" ON claim_payment_allocations FOR INSERT WITH CHECK (has_claim_access(claim_id));
CREATE POLICY "shared_users_update" ON claim_payment_allocations FOR UPDATE USING (has_claim_access(claim_id)) WITH CHECK (has_claim_access(claim_id));
CREATE POLICY "shared_users_delete" ON claim_payment_allocations FOR DELETE USING (has_claim_access(claim_id));

DROP POLICY IF EXISTS "shared_users_access" ON claim_payments;
DROP POLICY IF EXISTS "shared_users_select" ON claim_payments;
DROP POLICY IF EXISTS "shared_users_insert" ON claim_payments;
DROP POLICY IF EXISTS "shared_users_update" ON claim_payments;
DROP POLICY IF EXISTS "shared_users_delete" ON claim_payments;
CREATE POLICY "shared_users_select" ON claim_payments FOR SELECT USING (has_claim_access(claim_id));
CREATE POLICY "shared_users_insert" ON claim_payments FOR INSERT WITH CHECK (has_claim_access(claim_id));
CREATE POLICY "shared_users_update" ON claim_payments FOR UPDATE USING (has_claim_access(claim_id)) WITH CHECK (has_claim_access(claim_id));
CREATE POLICY "shared_users_delete" ON claim_payments FOR DELETE USING (has_claim_access(claim_id));

DROP POLICY IF EXISTS "shared_users_access" ON claims;
DROP POLICY IF EXISTS "shared_users_select" ON claims;
DROP POLICY IF EXISTS "shared_users_insert" ON claims;
DROP POLICY IF EXISTS "shared_users_update" ON claims;
DROP POLICY IF EXISTS "shared_users_delete" ON claims;
CREATE POLICY "shared_users_select" ON claims FOR SELECT USING (has_claim_columns_access(lease_id, tenant_id));
CREATE POLICY "shared_users_insert" ON claims FOR INSERT WITH CHECK (has_claim_columns_access(lease_id, tenant_id));
CREATE POLICY "shared_users_update" ON claims FOR UPDATE USING (has_claim_columns_access(lease_id, tenant_id)) WITH CHECK (has_claim_columns_access(lease_id, tenant_id));
CREATE POLICY "shared_users_delete" ON claims FOR DELETE USING (has_claim_columns_access(lease_id, tenant_id));

DROP POLICY IF EXISTS "shared_users_access" ON contacts;
DROP POLICY IF EXISTS "shared_users_select" ON contacts;
DROP POLICY IF EXISTS "shared_users_insert" ON contacts;
DROP POLICY IF EXISTS "shared_users_update" ON contacts;
DROP POLICY IF EXISTS "shared_users_delete" ON contacts;
DROP POLICY IF EXISTS "contacts_shared_select" ON contacts;
DROP POLICY IF EXISTS "contacts_shared_insert" ON contacts;
DROP POLICY IF EXISTS "contacts_shared_all" ON contacts;
CREATE POLICY "shared_users_select" ON contacts FOR SELECT USING (has_contact_access(id, user_id));
CREATE POLICY "shared_users_insert" ON contacts FOR INSERT WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON deals;
DROP POLICY IF EXISTS "shared_users_select" ON deals;
DROP POLICY IF EXISTS "shared_users_insert" ON deals;
DROP POLICY IF EXISTS "shared_users_update" ON deals;
DROP POLICY IF EXISTS "shared_users_delete" ON deals;
CREATE POLICY "shared_users_access" ON deals FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON distribution_keys;
DROP POLICY IF EXISTS "shared_users_select" ON distribution_keys;
DROP POLICY IF EXISTS "shared_users_insert" ON distribution_keys;
DROP POLICY IF EXISTS "shared_users_update" ON distribution_keys;
DROP POLICY IF EXISTS "shared_users_delete" ON distribution_keys;
DROP POLICY IF EXISTS "distribution_keys_shared_select" ON distribution_keys;
DROP POLICY IF EXISTS "distribution_keys_shared_insert" ON distribution_keys;
CREATE POLICY "shared_users_select" ON distribution_keys FOR SELECT USING (is_user_shared_with_me(user_id));
CREATE POLICY "shared_users_insert" ON distribution_keys FOR INSERT WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON documents;
DROP POLICY IF EXISTS "shared_users_select" ON documents;
DROP POLICY IF EXISTS "shared_users_insert" ON documents;
DROP POLICY IF EXISTS "shared_users_update" ON documents;
DROP POLICY IF EXISTS "shared_users_delete" ON documents;
CREATE POLICY "shared_users_access" ON documents FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON economic_units;
DROP POLICY IF EXISTS "shared_users_select" ON economic_units;
DROP POLICY IF EXISTS "shared_users_insert" ON economic_units;
DROP POLICY IF EXISTS "shared_users_update" ON economic_units;
DROP POLICY IF EXISTS "shared_users_delete" ON economic_units;
CREATE POLICY "shared_users_select" ON economic_units FOR SELECT USING (has_economic_unit_access(id));
CREATE POLICY "shared_users_insert" ON economic_units FOR INSERT WITH CHECK (is_user_shared_with_me(user_id));
CREATE POLICY "shared_users_update" ON economic_units FOR UPDATE USING (has_economic_unit_access(id)) WITH CHECK (is_user_shared_with_me(user_id));
CREATE POLICY "shared_users_delete" ON economic_units FOR DELETE USING (has_economic_unit_access(id));

DROP POLICY IF EXISTS "shared_users_access" ON expense_categories;
DROP POLICY IF EXISTS "shared_users_select" ON expense_categories;
DROP POLICY IF EXISTS "shared_users_insert" ON expense_categories;
DROP POLICY IF EXISTS "shared_users_update" ON expense_categories;
DROP POLICY IF EXISTS "shared_users_delete" ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_shared_select" ON expense_categories;
DROP POLICY IF EXISTS "expense_categories_shared_insert" ON expense_categories;
CREATE POLICY "shared_users_select" ON expense_categories FOR SELECT USING (is_user_shared_with_me(user_id));
CREATE POLICY "shared_users_insert" ON expense_categories FOR INSERT WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON expenses;
DROP POLICY IF EXISTS "shared_users_select" ON expenses;
DROP POLICY IF EXISTS "shared_users_insert" ON expenses;
DROP POLICY IF EXISTS "shared_users_update" ON expenses;
DROP POLICY IF EXISTS "shared_users_delete" ON expenses;
CREATE POLICY "shared_users_access" ON expenses FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON floor_plans;
DROP POLICY IF EXISTS "shared_users_select" ON floor_plans;
DROP POLICY IF EXISTS "shared_users_insert" ON floor_plans;
DROP POLICY IF EXISTS "shared_users_update" ON floor_plans;
DROP POLICY IF EXISTS "shared_users_delete" ON floor_plans;
CREATE POLICY "shared_users_access" ON floor_plans FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON invoice_counters;
DROP POLICY IF EXISTS "shared_users_select" ON invoice_counters;
DROP POLICY IF EXISTS "shared_users_insert" ON invoice_counters;
DROP POLICY IF EXISTS "shared_users_update" ON invoice_counters;
DROP POLICY IF EXISTS "shared_users_delete" ON invoice_counters;
CREATE POLICY "shared_users_access" ON invoice_counters FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON invoice_items;
DROP POLICY IF EXISTS "shared_users_select" ON invoice_items;
DROP POLICY IF EXISTS "shared_users_insert" ON invoice_items;
DROP POLICY IF EXISTS "shared_users_update" ON invoice_items;
DROP POLICY IF EXISTS "shared_users_delete" ON invoice_items;
CREATE POLICY "shared_users_select" ON invoice_items FOR SELECT USING (has_invoice_access(invoice_id));
CREATE POLICY "shared_users_insert" ON invoice_items FOR INSERT WITH CHECK (has_invoice_access(invoice_id));
CREATE POLICY "shared_users_update" ON invoice_items FOR UPDATE USING (has_invoice_access(invoice_id)) WITH CHECK (has_invoice_access(invoice_id));
CREATE POLICY "shared_users_delete" ON invoice_items FOR DELETE USING (has_invoice_access(invoice_id));

DROP POLICY IF EXISTS "shared_users_access" ON invoices;
DROP POLICY IF EXISTS "shared_users_select" ON invoices;
DROP POLICY IF EXISTS "shared_users_insert" ON invoices;
DROP POLICY IF EXISTS "shared_users_update" ON invoices;
DROP POLICY IF EXISTS "shared_users_delete" ON invoices;
CREATE POLICY "shared_users_access" ON invoices FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON leases;
DROP POLICY IF EXISTS "shared_users_select" ON leases;
DROP POLICY IF EXISTS "shared_users_insert" ON leases;
DROP POLICY IF EXISTS "shared_users_update" ON leases;
DROP POLICY IF EXISTS "shared_users_delete" ON leases;
CREATE POLICY "shared_users_access" ON leases FOR ALL USING (has_unit_access(unit_id)) WITH CHECK (has_unit_access(unit_id));

DROP POLICY IF EXISTS "shared_users_access" ON loans;
DROP POLICY IF EXISTS "shared_users_select" ON loans;
DROP POLICY IF EXISTS "shared_users_insert" ON loans;
DROP POLICY IF EXISTS "shared_users_update" ON loans;
DROP POLICY IF EXISTS "shared_users_delete" ON loans;
CREATE POLICY "shared_users_access" ON loans FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON messages;
DROP POLICY IF EXISTS "shared_users_select" ON messages;
DROP POLICY IF EXISTS "shared_users_insert" ON messages;
DROP POLICY IF EXISTS "shared_users_update" ON messages;
DROP POLICY IF EXISTS "shared_users_delete" ON messages;
DROP POLICY IF EXISTS "shared_users_access" ON meter_readings;
DROP POLICY IF EXISTS "shared_users_select" ON meter_readings;
DROP POLICY IF EXISTS "shared_users_insert" ON meter_readings;
DROP POLICY IF EXISTS "shared_users_update" ON meter_readings;
DROP POLICY IF EXISTS "shared_users_delete" ON meter_readings;
CREATE POLICY "shared_users_access" ON meter_readings FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON meters;
DROP POLICY IF EXISTS "shared_users_select" ON meters;
DROP POLICY IF EXISTS "shared_users_insert" ON meters;
DROP POLICY IF EXISTS "shared_users_update" ON meters;
DROP POLICY IF EXISTS "shared_users_delete" ON meters;
CREATE POLICY "shared_users_access" ON meters FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON objektkalender_events;
DROP POLICY IF EXISTS "shared_users_select" ON objektkalender_events;
DROP POLICY IF EXISTS "shared_users_insert" ON objektkalender_events;
DROP POLICY IF EXISTS "shared_users_update" ON objektkalender_events;
DROP POLICY IF EXISTS "shared_users_delete" ON objektkalender_events;
CREATE POLICY "shared_users_access" ON objektkalender_events FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON objektkalender_history;
DROP POLICY IF EXISTS "shared_users_select" ON objektkalender_history;
DROP POLICY IF EXISTS "shared_users_insert" ON objektkalender_history;
DROP POLICY IF EXISTS "shared_users_update" ON objektkalender_history;
DROP POLICY IF EXISTS "shared_users_delete" ON objektkalender_history;
CREATE POLICY "shared_users_access" ON objektkalender_history FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON objektkalender_settings;
DROP POLICY IF EXISTS "shared_users_select" ON objektkalender_settings;
DROP POLICY IF EXISTS "shared_users_insert" ON objektkalender_settings;
DROP POLICY IF EXISTS "shared_users_update" ON objektkalender_settings;
DROP POLICY IF EXISTS "shared_users_delete" ON objektkalender_settings;
CREATE POLICY "shared_users_access" ON objektkalender_settings FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON payment_plan_installments;
DROP POLICY IF EXISTS "shared_users_select" ON payment_plan_installments;
DROP POLICY IF EXISTS "shared_users_insert" ON payment_plan_installments;
DROP POLICY IF EXISTS "shared_users_update" ON payment_plan_installments;
DROP POLICY IF EXISTS "shared_users_delete" ON payment_plan_installments;
CREATE POLICY "shared_users_select" ON payment_plan_installments FOR SELECT USING (has_claim_access((SELECT claim_id FROM payment_plans WHERE id = payment_plan_id)));
CREATE POLICY "shared_users_insert" ON payment_plan_installments FOR INSERT WITH CHECK (has_claim_access((SELECT claim_id FROM payment_plans WHERE id = payment_plan_id)));
CREATE POLICY "shared_users_update" ON payment_plan_installments FOR UPDATE USING (has_claim_access((SELECT claim_id FROM payment_plans WHERE id = payment_plan_id))) WITH CHECK (has_claim_access((SELECT claim_id FROM payment_plans WHERE id = payment_plan_id)));
CREATE POLICY "shared_users_delete" ON payment_plan_installments FOR DELETE USING (has_claim_access((SELECT claim_id FROM payment_plans WHERE id = payment_plan_id)));

DROP POLICY IF EXISTS "shared_users_access" ON payment_plans;
DROP POLICY IF EXISTS "shared_users_select" ON payment_plans;
DROP POLICY IF EXISTS "shared_users_insert" ON payment_plans;
DROP POLICY IF EXISTS "shared_users_update" ON payment_plans;
DROP POLICY IF EXISTS "shared_users_delete" ON payment_plans;
CREATE POLICY "shared_users_select" ON payment_plans FOR SELECT USING (has_claim_access(claim_id));
CREATE POLICY "shared_users_insert" ON payment_plans FOR INSERT WITH CHECK (has_claim_access(claim_id));
CREATE POLICY "shared_users_update" ON payment_plans FOR UPDATE USING (has_claim_access(claim_id)) WITH CHECK (has_claim_access(claim_id));
CREATE POLICY "shared_users_delete" ON payment_plans FOR DELETE USING (has_claim_access(claim_id));

DROP POLICY IF EXISTS "shared_users_access" ON pdf_templates;
DROP POLICY IF EXISTS "shared_users_select" ON pdf_templates;
DROP POLICY IF EXISTS "shared_users_insert" ON pdf_templates;
DROP POLICY IF EXISTS "shared_users_update" ON pdf_templates;
DROP POLICY IF EXISTS "shared_users_delete" ON pdf_templates;
CREATE POLICY "shared_users_access" ON pdf_templates FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON portfolios;
DROP POLICY IF EXISTS "shared_users_select" ON portfolios;
DROP POLICY IF EXISTS "shared_users_insert" ON portfolios;
DROP POLICY IF EXISTS "shared_users_update" ON portfolios;
DROP POLICY IF EXISTS "shared_users_delete" ON portfolios;
CREATE POLICY "shared_users_select" ON portfolios FOR SELECT USING (has_portfolio_access(id));
CREATE POLICY "shared_users_insert" ON portfolios FOR INSERT WITH CHECK (is_user_shared_with_me(user_id));
CREATE POLICY "shared_users_update" ON portfolios FOR UPDATE USING (has_portfolio_access(id)) WITH CHECK (is_user_shared_with_me(user_id));
CREATE POLICY "shared_users_delete" ON portfolios FOR DELETE USING (has_portfolio_access(id));

DROP POLICY IF EXISTS "shared_users_access" ON properties;
DROP POLICY IF EXISTS "shared_users_select" ON properties;
DROP POLICY IF EXISTS "shared_users_insert" ON properties;
DROP POLICY IF EXISTS "shared_users_update" ON properties;
DROP POLICY IF EXISTS "shared_users_delete" ON properties;
CREATE POLICY "shared_users_access" ON properties FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_calc_subtrades;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_calc_subtrades;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_calc_subtrades;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_calc_subtrades;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_calc_subtrades;
CREATE POLICY "shared_users_select" ON renovation_calc_subtrades FOR SELECT USING (has_renovation_calc_trade_access(calc_trade_id));
CREATE POLICY "shared_users_insert" ON renovation_calc_subtrades FOR INSERT WITH CHECK (has_renovation_calc_trade_access(calc_trade_id));
CREATE POLICY "shared_users_update" ON renovation_calc_subtrades FOR UPDATE USING (has_renovation_calc_trade_access(calc_trade_id)) WITH CHECK (has_renovation_calc_trade_access(calc_trade_id));
CREATE POLICY "shared_users_delete" ON renovation_calc_subtrades FOR DELETE USING (has_renovation_calc_trade_access(calc_trade_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_calc_trades;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_calc_trades;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_calc_trades;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_calc_trades;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_calc_trades;
CREATE POLICY "shared_users_select" ON renovation_calc_trades FOR SELECT USING (has_renovation_calculation_access(calculation_id));
CREATE POLICY "shared_users_insert" ON renovation_calc_trades FOR INSERT WITH CHECK (has_renovation_calculation_access(calculation_id));
CREATE POLICY "shared_users_update" ON renovation_calc_trades FOR UPDATE USING (has_renovation_calculation_access(calculation_id)) WITH CHECK (has_renovation_calculation_access(calculation_id));
CREATE POLICY "shared_users_delete" ON renovation_calc_trades FOR DELETE USING (has_renovation_calculation_access(calculation_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_calculations;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_calculations;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_calculations;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_calculations;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_calculations;
CREATE POLICY "shared_users_access" ON renovation_calculations FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_invoices;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_invoices;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_invoices;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_invoices;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_invoices;
CREATE POLICY "shared_users_select" ON renovation_invoices FOR SELECT USING (has_renovation_project_access(project_id));
CREATE POLICY "shared_users_insert" ON renovation_invoices FOR INSERT WITH CHECK (has_renovation_project_access(project_id));
CREATE POLICY "shared_users_update" ON renovation_invoices FOR UPDATE USING (has_renovation_project_access(project_id)) WITH CHECK (has_renovation_project_access(project_id));
CREATE POLICY "shared_users_delete" ON renovation_invoices FOR DELETE USING (has_renovation_project_access(project_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_milestone_templates;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_milestone_templates;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_milestone_templates;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_milestone_templates;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_milestone_templates;
DROP POLICY IF EXISTS "renovation_milestone_templates_shared_select" ON renovation_milestone_templates;
DROP POLICY IF EXISTS "renovation_milestone_templates_shared_insert" ON renovation_milestone_templates;
CREATE POLICY "shared_users_select" ON renovation_milestone_templates FOR SELECT USING (is_user_shared_with_me(user_id));
CREATE POLICY "shared_users_insert" ON renovation_milestone_templates FOR INSERT WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_milestones;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_milestones;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_milestones;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_milestones;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_milestones;
CREATE POLICY "shared_users_select" ON renovation_milestones FOR SELECT USING (has_renovation_project_trade_access(project_trade_id));
CREATE POLICY "shared_users_insert" ON renovation_milestones FOR INSERT WITH CHECK (has_renovation_project_trade_access(project_trade_id));
CREATE POLICY "shared_users_update" ON renovation_milestones FOR UPDATE USING (has_renovation_project_trade_access(project_trade_id)) WITH CHECK (has_renovation_project_trade_access(project_trade_id));
CREATE POLICY "shared_users_delete" ON renovation_milestones FOR DELETE USING (has_renovation_project_trade_access(project_trade_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_positions;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_positions;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_positions;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_positions;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_positions;
DROP POLICY IF EXISTS "renovation_positions_shared_select" ON renovation_positions;
DROP POLICY IF EXISTS "renovation_positions_shared_insert" ON renovation_positions;
CREATE POLICY "shared_users_select" ON renovation_positions FOR SELECT USING (is_user_shared_with_me(user_id));
CREATE POLICY "shared_users_insert" ON renovation_positions FOR INSERT WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_project_subtrades;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_project_subtrades;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_project_subtrades;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_project_subtrades;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_project_subtrades;
CREATE POLICY "shared_users_select" ON renovation_project_subtrades FOR SELECT USING (has_renovation_project_access(project_id));
CREATE POLICY "shared_users_insert" ON renovation_project_subtrades FOR INSERT WITH CHECK (has_renovation_project_access(project_id));
CREATE POLICY "shared_users_update" ON renovation_project_subtrades FOR UPDATE USING (has_renovation_project_access(project_id)) WITH CHECK (has_renovation_project_access(project_id));
CREATE POLICY "shared_users_delete" ON renovation_project_subtrades FOR DELETE USING (has_renovation_project_access(project_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_project_trades;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_project_trades;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_project_trades;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_project_trades;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_project_trades;
CREATE POLICY "shared_users_select" ON renovation_project_trades FOR SELECT USING (has_renovation_project_access(project_id));
CREATE POLICY "shared_users_insert" ON renovation_project_trades FOR INSERT WITH CHECK (has_renovation_project_access(project_id));
CREATE POLICY "shared_users_update" ON renovation_project_trades FOR UPDATE USING (has_renovation_project_access(project_id)) WITH CHECK (has_renovation_project_access(project_id));
CREATE POLICY "shared_users_delete" ON renovation_project_trades FOR DELETE USING (has_renovation_project_access(project_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_projects;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_projects;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_projects;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_projects;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_projects;
CREATE POLICY "shared_users_access" ON renovation_projects FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_subtrades;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_subtrades;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_subtrades;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_subtrades;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_subtrades;
DROP POLICY IF EXISTS "renovation_subtrades_shared_select" ON renovation_subtrades;
DROP POLICY IF EXISTS "renovation_subtrades_shared_insert" ON renovation_subtrades;
CREATE POLICY "shared_users_select" ON renovation_subtrades FOR SELECT USING (is_user_shared_with_me(user_id));
CREATE POLICY "shared_users_insert" ON renovation_subtrades FOR INSERT WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_tasks;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_tasks;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_tasks;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_tasks;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_tasks;
CREATE POLICY "shared_users_access" ON renovation_tasks FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON renovation_trades;
DROP POLICY IF EXISTS "shared_users_select" ON renovation_trades;
DROP POLICY IF EXISTS "shared_users_insert" ON renovation_trades;
DROP POLICY IF EXISTS "shared_users_update" ON renovation_trades;
DROP POLICY IF EXISTS "shared_users_delete" ON renovation_trades;
DROP POLICY IF EXISTS "renovation_trades_shared_select" ON renovation_trades;
DROP POLICY IF EXISTS "renovation_trades_shared_insert" ON renovation_trades;
CREATE POLICY "shared_users_select" ON renovation_trades FOR SELECT USING (is_user_shared_with_me(user_id));
CREATE POLICY "shared_users_insert" ON renovation_trades FOR INSERT WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "shared_users_access" ON rent_charges;
DROP POLICY IF EXISTS "shared_users_select" ON rent_charges;
DROP POLICY IF EXISTS "shared_users_insert" ON rent_charges;
DROP POLICY IF EXISTS "shared_users_update" ON rent_charges;
DROP POLICY IF EXISTS "shared_users_delete" ON rent_charges;
CREATE POLICY "shared_users_select" ON rent_charges FOR SELECT USING (has_lease_access(lease_id));
CREATE POLICY "shared_users_insert" ON rent_charges FOR INSERT WITH CHECK (has_lease_access(lease_id));
CREATE POLICY "shared_users_update" ON rent_charges FOR UPDATE USING (has_lease_access(lease_id)) WITH CHECK (has_lease_access(lease_id));
CREATE POLICY "shared_users_delete" ON rent_charges FOR DELETE USING (has_lease_access(lease_id));

DROP POLICY IF EXISTS "shared_users_access" ON rent_ledger;
DROP POLICY IF EXISTS "shared_users_select" ON rent_ledger;
DROP POLICY IF EXISTS "shared_users_insert" ON rent_ledger;
DROP POLICY IF EXISTS "shared_users_update" ON rent_ledger;
DROP POLICY IF EXISTS "shared_users_delete" ON rent_ledger;
DROP POLICY IF EXISTS "rent_ledger_shared_all" ON rent_ledger;
CREATE POLICY "shared_users_select" ON rent_ledger FOR SELECT USING (has_lease_access(lease_id));
CREATE POLICY "shared_users_insert" ON rent_ledger FOR INSERT WITH CHECK (has_lease_access(lease_id));
CREATE POLICY "shared_users_update" ON rent_ledger FOR UPDATE USING (has_lease_access(lease_id)) WITH CHECK (has_lease_access(lease_id));
CREATE POLICY "shared_users_delete" ON rent_ledger FOR DELETE USING (has_lease_access(lease_id));

DROP POLICY IF EXISTS "shared_users_access" ON rent_payments;
DROP POLICY IF EXISTS "shared_users_select" ON rent_payments;
DROP POLICY IF EXISTS "shared_users_insert" ON rent_payments;
DROP POLICY IF EXISTS "shared_users_update" ON rent_payments;
DROP POLICY IF EXISTS "shared_users_delete" ON rent_payments;
DROP POLICY IF EXISTS "rent_payments_shared_all" ON rent_payments;
CREATE POLICY "shared_users_select" ON rent_payments FOR SELECT USING (has_lease_access(lease_id));
CREATE POLICY "shared_users_insert" ON rent_payments FOR INSERT WITH CHECK (has_lease_access(lease_id));
CREATE POLICY "shared_users_update" ON rent_payments FOR UPDATE USING (has_lease_access(lease_id)) WITH CHECK (has_lease_access(lease_id));
CREATE POLICY "shared_users_delete" ON rent_payments FOR DELETE USING (has_lease_access(lease_id));

DROP POLICY IF EXISTS "shared_users_access" ON tenant_invitations;
DROP POLICY IF EXISTS "shared_users_select" ON tenant_invitations;
DROP POLICY IF EXISTS "shared_users_insert" ON tenant_invitations;
DROP POLICY IF EXISTS "shared_users_update" ON tenant_invitations;
DROP POLICY IF EXISTS "shared_users_delete" ON tenant_invitations;
CREATE POLICY "shared_users_access" ON tenant_invitations FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON tenants;
DROP POLICY IF EXISTS "shared_users_select" ON tenants;
DROP POLICY IF EXISTS "shared_users_insert" ON tenants;
DROP POLICY IF EXISTS "shared_users_update" ON tenants;
DROP POLICY IF EXISTS "shared_users_delete" ON tenants;
DROP POLICY IF EXISTS "tenants_shared_all" ON tenants;
DROP POLICY IF EXISTS "tenants_shared_insert" ON tenants;
CREATE POLICY "shared_users_select" ON tenants FOR SELECT USING (has_tenant_access(id));
CREATE POLICY "shared_users_insert" ON tenants FOR INSERT WITH CHECK (is_user_shared_with_me(user_id));
CREATE POLICY "shared_users_update" ON tenants FOR UPDATE USING (has_tenant_access(id)) WITH CHECK (is_user_shared_with_me(user_id));
CREATE POLICY "shared_users_delete" ON tenants FOR DELETE USING (has_tenant_access(id));

DROP POLICY IF EXISTS "shared_users_access" ON tickets;
DROP POLICY IF EXISTS "shared_users_select" ON tickets;
DROP POLICY IF EXISTS "shared_users_insert" ON tickets;
DROP POLICY IF EXISTS "shared_users_update" ON tickets;
DROP POLICY IF EXISTS "shared_users_delete" ON tickets;
CREATE POLICY "shared_users_access" ON tickets FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON units;
DROP POLICY IF EXISTS "shared_users_select" ON units;
DROP POLICY IF EXISTS "shared_users_insert" ON units;
DROP POLICY IF EXISTS "shared_users_update" ON units;
DROP POLICY IF EXISTS "shared_users_delete" ON units;
CREATE POLICY "shared_users_access" ON units FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "shared_users_access" ON utility_settlements;
DROP POLICY IF EXISTS "shared_users_select" ON utility_settlements;
DROP POLICY IF EXISTS "shared_users_insert" ON utility_settlements;
DROP POLICY IF EXISTS "shared_users_update" ON utility_settlements;
DROP POLICY IF EXISTS "shared_users_delete" ON utility_settlements;
CREATE POLICY "shared_users_access" ON utility_settlements FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

