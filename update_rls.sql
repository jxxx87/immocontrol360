-- Helper Functions
CREATE OR REPLACE FUNCTION has_portfolio_access(check_portfolio_id UUID) RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM portfolios WHERE id = check_portfolio_id AND user_id = auth.uid()) 
        OR EXISTS (SELECT 1 FROM portfolio_shares WHERE portfolio_id = check_portfolio_id AND shared_with_email = (auth.jwt()->>'email') AND status = 'accepted');
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
    RETURN check_user_id = auth.uid() 
        OR EXISTS (
            SELECT 1 FROM portfolio_shares ps 
            JOIN portfolios p ON p.id = ps.portfolio_id 
            WHERE p.user_id = check_user_id 
            AND ps.shared_with_email = (auth.jwt()->>'email') 
            AND ps.status = 'accepted'
        );
END;
$$ LANGUAGE plpgsql;

DROP POLICY IF EXISTS "investors_manage_own_announcements" ON announcements;
CREATE POLICY "investors_manage_own_announcements" ON announcements FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "tenants_read_announcements" ON announcements;
CREATE POLICY "tenants_read_announcements" ON announcements FOR SELECT USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "Delete claim_events" ON claim_events;
CREATE POLICY "Delete claim_events" ON claim_events FOR DELETE USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Insert claim_events" ON claim_events;
CREATE POLICY "Insert claim_events" ON claim_events FOR INSERT  WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Select claim_events" ON claim_events;
CREATE POLICY "Select claim_events" ON claim_events FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Update claim_events" ON claim_events;
CREATE POLICY "Update claim_events" ON claim_events FOR UPDATE USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Insert claim_items" ON claim_items;
CREATE POLICY "Insert claim_items" ON claim_items FOR INSERT  WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Select claim_items" ON claim_items;
CREATE POLICY "Select claim_items" ON claim_items FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Update claim_items" ON claim_items;
CREATE POLICY "Update claim_items" ON claim_items FOR UPDATE USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Insert claim_payment_allocations" ON claim_payment_allocations;
CREATE POLICY "Insert claim_payment_allocations" ON claim_payment_allocations FOR INSERT  WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Select claim_payment_allocations" ON claim_payment_allocations;
CREATE POLICY "Select claim_payment_allocations" ON claim_payment_allocations FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Update claim_payment_allocations" ON claim_payment_allocations;
CREATE POLICY "Update claim_payment_allocations" ON claim_payment_allocations FOR UPDATE USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Insert claim_payments" ON claim_payments;
CREATE POLICY "Insert claim_payments" ON claim_payments FOR INSERT  WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Select claim_payments" ON claim_payments;
CREATE POLICY "Select claim_payments" ON claim_payments FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Update claim_payments" ON claim_payments;
CREATE POLICY "Update claim_payments" ON claim_payments FOR UPDATE USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Insert claims" ON claims;
CREATE POLICY "Insert claims" ON claims FOR INSERT  WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Select claims" ON claims;
CREATE POLICY "Select claims" ON claims FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Update claims" ON claims;
CREATE POLICY "Update claims" ON claims FOR UPDATE USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "contacts_own_all" ON contacts;
CREATE POLICY "contacts_own_all" ON contacts FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users can manage own deals" ON deals;
CREATE POLICY "Users can manage own deals" ON deals FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "Users can delete their own keys" ON distribution_keys;
CREATE POLICY "Users can delete their own keys" ON distribution_keys FOR DELETE USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Users can insert their own keys" ON distribution_keys;
CREATE POLICY "Users can insert their own keys" ON distribution_keys FOR INSERT  WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users can update their own keys" ON distribution_keys;
CREATE POLICY "Users can update their own keys" ON distribution_keys FOR UPDATE USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users can view their own keys and standard keys" ON distribution_keys;
CREATE POLICY "Users can view their own keys and standard keys" ON distribution_keys FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "documents_own_all" ON documents;
CREATE POLICY "documents_own_all" ON documents FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "tenants_read_general_docs" ON documents;
CREATE POLICY "tenants_read_general_docs" ON documents FOR SELECT USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "tenants_read_personal_docs" ON documents;
CREATE POLICY "tenants_read_personal_docs" ON documents FOR SELECT USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "Users can delete their own economic units" ON economic_units;
CREATE POLICY "Users can delete their own economic units" ON economic_units FOR DELETE USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Users can insert their own economic units" ON economic_units;
CREATE POLICY "Users can insert their own economic units" ON economic_units FOR INSERT  WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users can update their own economic units" ON economic_units;
CREATE POLICY "Users can update their own economic units" ON economic_units FOR UPDATE USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users can view their own economic units" ON economic_units;
CREATE POLICY "Users can view their own economic units" ON economic_units FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Users can delete their own categories" ON expense_categories;
CREATE POLICY "Users can delete their own categories" ON expense_categories FOR DELETE USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Users can insert their own categories" ON expense_categories;
CREATE POLICY "Users can insert their own categories" ON expense_categories FOR INSERT  WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users can update their own categories" ON expense_categories;
CREATE POLICY "Users can update their own categories" ON expense_categories FOR UPDATE USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users can view their own and standard categories" ON expense_categories;
CREATE POLICY "Users can view their own and standard categories" ON expense_categories FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "expense_categories_own_all" ON expense_categories;
CREATE POLICY "expense_categories_own_all" ON expense_categories FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "expenses_own_all" ON expenses;
CREATE POLICY "expenses_own_all" ON expenses FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Users can delete their own floor plans" ON floor_plans;
CREATE POLICY "Users can delete their own floor plans" ON floor_plans FOR DELETE USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "Users can insert their own floor plans" ON floor_plans;
CREATE POLICY "Users can insert their own floor plans" ON floor_plans FOR INSERT  WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Users can update their own floor plans" ON floor_plans;
CREATE POLICY "Users can update their own floor plans" ON floor_plans FOR UPDATE USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Users can view their own floor plans" ON floor_plans;
CREATE POLICY "Users can view their own floor plans" ON floor_plans FOR SELECT USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "invoice_counters_own_all" ON invoice_counters;
CREATE POLICY "invoice_counters_own_all" ON invoice_counters FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "invoice_items_own_all" ON invoice_items;
CREATE POLICY "invoice_items_own_all" ON invoice_items FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "invoices_own_all" ON invoices;
CREATE POLICY "invoices_own_all" ON invoices FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "leases_own_all" ON leases;
CREATE POLICY "leases_own_all" ON leases FOR ALL USING (has_unit_access(unit_id)) WITH CHECK (has_unit_access(unit_id));

DROP POLICY IF EXISTS "tenants_read_own_leases" ON leases;
CREATE POLICY "tenants_read_own_leases" ON leases FOR SELECT USING (has_unit_access(unit_id)) ;

DROP POLICY IF EXISTS "Users can delete their own loans" ON loans;
CREATE POLICY "Users can delete their own loans" ON loans FOR DELETE USING (has_portfolio_access(portfolio_id)) ;

DROP POLICY IF EXISTS "Users can insert their own loans" ON loans;
CREATE POLICY "Users can insert their own loans" ON loans FOR INSERT  WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "Users can update their own loans" ON loans;
CREATE POLICY "Users can update their own loans" ON loans FOR UPDATE USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "Users can view their own loans" ON loans;
CREATE POLICY "Users can view their own loans" ON loans FOR SELECT USING (has_portfolio_access(portfolio_id)) ;

DROP POLICY IF EXISTS "Users can delete their own meter readings" ON meter_readings;
CREATE POLICY "Users can delete their own meter readings" ON meter_readings FOR DELETE USING (has_portfolio_access(portfolio_id)) ;

DROP POLICY IF EXISTS "Users can insert their own meter readings" ON meter_readings;
CREATE POLICY "Users can insert their own meter readings" ON meter_readings FOR INSERT  WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "Users can update their own meter readings" ON meter_readings;
CREATE POLICY "Users can update their own meter readings" ON meter_readings FOR UPDATE USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "Users can view their own meter readings" ON meter_readings;
CREATE POLICY "Users can view their own meter readings" ON meter_readings FOR SELECT USING (has_portfolio_access(portfolio_id)) ;

DROP POLICY IF EXISTS "Users can delete their own meters" ON meters;
CREATE POLICY "Users can delete their own meters" ON meters FOR DELETE USING (has_portfolio_access(portfolio_id)) ;

DROP POLICY IF EXISTS "Users can insert their own meters" ON meters;
CREATE POLICY "Users can insert their own meters" ON meters FOR INSERT  WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "Users can update their own meters" ON meters;
CREATE POLICY "Users can update their own meters" ON meters FOR UPDATE USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "Users can view their own meters" ON meters;
CREATE POLICY "Users can view their own meters" ON meters FOR SELECT USING (has_portfolio_access(portfolio_id)) ;

DROP POLICY IF EXISTS "ok_tenants_read_events" ON objektkalender_events;
CREATE POLICY "ok_tenants_read_events" ON objektkalender_events FOR SELECT USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "ok_tenants_update_own_events" ON objektkalender_events;
CREATE POLICY "ok_tenants_update_own_events" ON objektkalender_events FOR UPDATE USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "ok_users_own_events" ON objektkalender_events;
CREATE POLICY "ok_users_own_events" ON objektkalender_events FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "ok_tenants_insert_history" ON objektkalender_history;
CREATE POLICY "ok_tenants_insert_history" ON objektkalender_history FOR INSERT  WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "ok_tenants_read_history" ON objektkalender_history;
CREATE POLICY "ok_tenants_read_history" ON objektkalender_history FOR SELECT USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "ok_users_own_history" ON objektkalender_history;
CREATE POLICY "ok_users_own_history" ON objektkalender_history FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "ok_tenants_read_settings" ON objektkalender_settings;
CREATE POLICY "ok_tenants_read_settings" ON objektkalender_settings FOR SELECT USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "ok_users_own_settings" ON objektkalender_settings;
CREATE POLICY "ok_users_own_settings" ON objektkalender_settings FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Insert installments" ON payment_plan_installments;
CREATE POLICY "Insert installments" ON payment_plan_installments FOR INSERT  WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Select installments" ON payment_plan_installments;
CREATE POLICY "Select installments" ON payment_plan_installments FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Update installments" ON payment_plan_installments;
CREATE POLICY "Update installments" ON payment_plan_installments FOR UPDATE USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Insert payment_plans" ON payment_plans;
CREATE POLICY "Insert payment_plans" ON payment_plans FOR INSERT  WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Select payment_plans" ON payment_plans;
CREATE POLICY "Select payment_plans" ON payment_plans FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Update payment_plans" ON payment_plans;
CREATE POLICY "Update payment_plans" ON payment_plans FOR UPDATE USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users can manage pdf_templates for their portfolios" ON pdf_templates;
CREATE POLICY "Users can manage pdf_templates for their portfolios" ON pdf_templates FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "Shared users can view portfolio" ON portfolios;
CREATE POLICY "Shared users can view portfolio" ON portfolios FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Tenants can view their property portfolio" ON portfolios;
CREATE POLICY "Tenants can view their property portfolio" ON portfolios FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "portfolios_own_all" ON portfolios;
CREATE POLICY "portfolios_own_all" ON portfolios FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users can delete their own properties" ON properties;
CREATE POLICY "Users can delete their own properties" ON properties FOR DELETE USING (has_portfolio_access(portfolio_id)) ;

DROP POLICY IF EXISTS "Users can insert their own properties" ON properties;
CREATE POLICY "Users can insert their own properties" ON properties FOR INSERT  WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "Users can update their own properties" ON properties;
CREATE POLICY "Users can update their own properties" ON properties FOR UPDATE USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "Users can view their own properties" ON properties;
CREATE POLICY "Users can view their own properties" ON properties FOR SELECT USING (has_portfolio_access(portfolio_id)) ;

DROP POLICY IF EXISTS "properties_own_all" ON properties;
CREATE POLICY "properties_own_all" ON properties FOR ALL USING (has_portfolio_access(portfolio_id)) WITH CHECK (has_portfolio_access(portfolio_id));

DROP POLICY IF EXISTS "tenants_read_own_property" ON properties;
CREATE POLICY "tenants_read_own_property" ON properties FOR SELECT USING (has_portfolio_access(portfolio_id)) ;

DROP POLICY IF EXISTS "Users manage own renovation_calc_subtrades" ON renovation_calc_subtrades;
CREATE POLICY "Users manage own renovation_calc_subtrades" ON renovation_calc_subtrades FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users manage own renovation_calc_trades" ON renovation_calc_trades;
CREATE POLICY "Users manage own renovation_calc_trades" ON renovation_calc_trades FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users manage own renovation_calculations" ON renovation_calculations;
CREATE POLICY "Users manage own renovation_calculations" ON renovation_calculations FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Users manage own renovation_invoices" ON renovation_invoices;
CREATE POLICY "Users manage own renovation_invoices" ON renovation_invoices FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users manage own renovation_milestone_templates" ON renovation_milestone_templates;
CREATE POLICY "Users manage own renovation_milestone_templates" ON renovation_milestone_templates FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users manage own renovation_milestones" ON renovation_milestones;
CREATE POLICY "Users manage own renovation_milestones" ON renovation_milestones FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users manage own renovation_positions" ON renovation_positions;
CREATE POLICY "Users manage own renovation_positions" ON renovation_positions FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users manage own renovation_project_subtrades" ON renovation_project_subtrades;
CREATE POLICY "Users manage own renovation_project_subtrades" ON renovation_project_subtrades FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users manage own renovation_project_trades" ON renovation_project_trades;
CREATE POLICY "Users manage own renovation_project_trades" ON renovation_project_trades FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users manage own renovation_projects" ON renovation_projects;
CREATE POLICY "Users manage own renovation_projects" ON renovation_projects FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Users manage own renovation_subtrades" ON renovation_subtrades;
CREATE POLICY "Users manage own renovation_subtrades" ON renovation_subtrades FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Users manage own renovation_tasks" ON renovation_tasks;
CREATE POLICY "Users manage own renovation_tasks" ON renovation_tasks FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Users manage own renovation_trades" ON renovation_trades;
CREATE POLICY "Users manage own renovation_trades" ON renovation_trades FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "rent_charges_own_all" ON rent_charges;
CREATE POLICY "rent_charges_own_all" ON rent_charges FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Benutzer können eigene Ledger-Einträge bearbeiten" ON rent_ledger;
CREATE POLICY "Benutzer können eigene Ledger-Einträge bearbeiten" ON rent_ledger FOR UPDATE USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Benutzer können eigene Ledger-Einträge erstellen" ON rent_ledger;
CREATE POLICY "Benutzer können eigene Ledger-Einträge erstellen" ON rent_ledger FOR INSERT  WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "Benutzer können eigene Ledger-Einträge löschen" ON rent_ledger;
CREATE POLICY "Benutzer können eigene Ledger-Einträge löschen" ON rent_ledger FOR DELETE USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "Benutzer können nur eigene Ledger-Einträge sehen" ON rent_ledger;
CREATE POLICY "Benutzer können nur eigene Ledger-Einträge sehen" ON rent_ledger FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "rent_payments_own_all" ON rent_payments;
CREATE POLICY "rent_payments_own_all" ON rent_payments FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "investors_manage_own_invitations" ON tenant_invitations;
CREATE POLICY "investors_manage_own_invitations" ON tenant_invitations FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "tenants_own_all" ON tenants;
CREATE POLICY "tenants_own_all" ON tenants FOR ALL USING (is_user_shared_with_me(user_id)) WITH CHECK (is_user_shared_with_me(user_id));

DROP POLICY IF EXISTS "tenants_read_own_tenant" ON tenants;
CREATE POLICY "tenants_read_own_tenant" ON tenants FOR SELECT USING (is_user_shared_with_me(user_id)) ;

DROP POLICY IF EXISTS "investors_delete_tickets" ON tickets;
CREATE POLICY "investors_delete_tickets" ON tickets FOR DELETE USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "investors_manage_own_tickets" ON tickets;
CREATE POLICY "investors_manage_own_tickets" ON tickets FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "tenants_manage_own_tickets" ON tickets;
CREATE POLICY "tenants_manage_own_tickets" ON tickets FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Users can delete their own units" ON units;
CREATE POLICY "Users can delete their own units" ON units FOR DELETE USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "Users can insert their own units" ON units;
CREATE POLICY "Users can insert their own units" ON units FOR INSERT  WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Users can update their own units" ON units;
CREATE POLICY "Users can update their own units" ON units FOR UPDATE USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Users can view their own units" ON units;
CREATE POLICY "Users can view their own units" ON units FOR SELECT USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "tenants_read_own_unit" ON units;
CREATE POLICY "tenants_read_own_unit" ON units FOR SELECT USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "units_own_all" ON units;
CREATE POLICY "units_own_all" ON units FOR ALL USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Users can delete own settlements" ON utility_settlements;
CREATE POLICY "Users can delete own settlements" ON utility_settlements FOR DELETE USING (has_property_access(property_id)) ;

DROP POLICY IF EXISTS "Users can insert own settlements" ON utility_settlements;
CREATE POLICY "Users can insert own settlements" ON utility_settlements FOR INSERT  WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Users can update own settlements" ON utility_settlements;
CREATE POLICY "Users can update own settlements" ON utility_settlements FOR UPDATE USING (has_property_access(property_id)) WITH CHECK (has_property_access(property_id));

DROP POLICY IF EXISTS "Users can view own settlements" ON utility_settlements;
CREATE POLICY "Users can view own settlements" ON utility_settlements FOR SELECT USING (has_property_access(property_id)) ;

