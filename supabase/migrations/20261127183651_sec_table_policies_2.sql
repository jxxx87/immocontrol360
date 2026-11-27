-- =============================================================================
-- 4. Forderungen (finanzen): claims, claim_*, payment_plan*
--    Geldwirksame Schritte laufen über SECURITY-DEFINER-RPCs (MONEY-DB); die
--    Policies regeln nur den direkten Tabellenzugriff.
-- =============================================================================

-- ---------------------------------------------------------------- claims
-- Kein DELETE (Trigger block_claims_delete, bisher auch keine Eigentümer-Policy).
alter table public.claims enable row level security;

drop policy if exists "shared_users_delete" on public.claims;
drop policy if exists "Insert claims" on public.claims;
drop policy if exists "shared_users_insert" on public.claims;
drop policy if exists "Select claims" on public.claims;
drop policy if exists "shared_users_select" on public.claims;
drop policy if exists "Update claims" on public.claims;
drop policy if exists "shared_users_update" on public.claims;
drop policy if exists claims_select on public.claims;
drop policy if exists claims_insert on public.claims;
drop policy if exists claims_update on public.claims;

create policy claims_select on public.claims
  for select to authenticated
  using (public.has_lease_access(lease_id, 'finanzen', 'read'));

create policy claims_insert on public.claims
  for insert to authenticated
  with check (
    public.has_lease_access(lease_id, 'finanzen', 'write')
    and public.rls_user_ok(user_id, 'lease', lease_id)
    and public.rls_tenant_ok(tenant_id, 'lease', lease_id)
  );

create policy claims_update on public.claims
  for update to authenticated
  using (public.has_lease_access(lease_id, 'finanzen', 'write'))
  with check (
    public.has_lease_access(lease_id, 'finanzen', 'write')
    and (public.rls_tenant_ok(tenant_id, 'lease', lease_id)
         or public.rls_tenant_link_unchanged('claims', id, tenant_id))
  );


-- ---------------------------------------------------------------- claim_access_links
alter table public.claim_access_links enable row level security;

drop policy if exists "Users can manage access links for their portfolios" on public.claim_access_links;
drop policy if exists "shared_users_delete" on public.claim_access_links;
drop policy if exists "shared_users_insert" on public.claim_access_links;
drop policy if exists "shared_users_select" on public.claim_access_links;
drop policy if exists "shared_users_update" on public.claim_access_links;
drop policy if exists claim_access_links_select on public.claim_access_links;
drop policy if exists claim_access_links_insert on public.claim_access_links;
drop policy if exists claim_access_links_update on public.claim_access_links;
drop policy if exists claim_access_links_delete on public.claim_access_links;

create policy claim_access_links_select on public.claim_access_links
  for select to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'read'));

create policy claim_access_links_insert on public.claim_access_links
  for insert to authenticated
  with check (
    public.has_claim_access(claim_id, 'finanzen', 'write')
    and (created_by is null or created_by = (select auth.uid()))
  );

create policy claim_access_links_update on public.claim_access_links
  for update to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'))
  with check (public.has_claim_access(claim_id, 'finanzen', 'write'));

create policy claim_access_links_delete on public.claim_access_links
  for delete to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'));


-- ---------------------------------------------------------------- claim_events
-- D3a-10 (teilweise): Ändern/Löschen nur noch mit Schreibrecht "finanzen".
-- Die App ändert (Mahnung neu erzeugt) und löscht (Timeline) Ereignisse heute
-- direkt; ein vollständiges Sperren bricht diese Abläufe (siehe Bericht).
alter table public.claim_events enable row level security;

drop policy if exists "claim_events_owner_all" on public.claim_events;
drop policy if exists "claim_events_shared_all" on public.claim_events;
drop policy if exists "shared_users_delete" on public.claim_events;
drop policy if exists "shared_users_insert" on public.claim_events;
drop policy if exists "shared_users_select" on public.claim_events;
drop policy if exists "shared_users_update" on public.claim_events;
drop policy if exists claim_events_select on public.claim_events;
drop policy if exists claim_events_insert on public.claim_events;
drop policy if exists claim_events_update on public.claim_events;
drop policy if exists claim_events_delete on public.claim_events;

create policy claim_events_select on public.claim_events
  for select to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'read'));

create policy claim_events_insert on public.claim_events
  for insert to authenticated
  with check (
    public.has_claim_access(claim_id, 'finanzen', 'write')
    and public.rls_user_ok(user_id, 'claim', claim_id)
  );

create policy claim_events_update on public.claim_events
  for update to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'))
  with check (public.has_claim_access(claim_id, 'finanzen', 'write'));

create policy claim_events_delete on public.claim_events
  for delete to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'));


-- ---------------------------------------------------------------- claim_items
alter table public.claim_items enable row level security;

drop policy if exists "claim_items_owner_all" on public.claim_items;
drop policy if exists "claim_items_shared_all" on public.claim_items;
drop policy if exists "shared_users_delete" on public.claim_items;
drop policy if exists "shared_users_insert" on public.claim_items;
drop policy if exists "shared_users_select" on public.claim_items;
drop policy if exists "shared_users_update" on public.claim_items;
drop policy if exists claim_items_select on public.claim_items;
drop policy if exists claim_items_insert on public.claim_items;
drop policy if exists claim_items_update on public.claim_items;
drop policy if exists claim_items_delete on public.claim_items;

create policy claim_items_select on public.claim_items
  for select to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'read'));

create policy claim_items_insert on public.claim_items
  for insert to authenticated
  with check (
    public.has_claim_access(claim_id, 'finanzen', 'write')
    and public.rls_user_ok(user_id, 'claim', claim_id)
  );

create policy claim_items_update on public.claim_items
  for update to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'))
  with check (public.has_claim_access(claim_id, 'finanzen', 'write'));

create policy claim_items_delete on public.claim_items
  for delete to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'));


-- ---------------------------------------------------------------- claim_payments
alter table public.claim_payments enable row level security;

drop policy if exists "claim_payments_owner_all" on public.claim_payments;
drop policy if exists "claim_payments_shared_all" on public.claim_payments;
drop policy if exists "shared_users_delete" on public.claim_payments;
drop policy if exists "shared_users_insert" on public.claim_payments;
drop policy if exists "shared_users_select" on public.claim_payments;
drop policy if exists "shared_users_update" on public.claim_payments;
drop policy if exists claim_payments_select on public.claim_payments;
drop policy if exists claim_payments_insert on public.claim_payments;
drop policy if exists claim_payments_update on public.claim_payments;
drop policy if exists claim_payments_delete on public.claim_payments;

create policy claim_payments_select on public.claim_payments
  for select to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'read'));

create policy claim_payments_insert on public.claim_payments
  for insert to authenticated
  with check (
    public.has_claim_access(claim_id, 'finanzen', 'write')
    and public.rls_user_ok(user_id, 'claim', claim_id)
  );

create policy claim_payments_update on public.claim_payments
  for update to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'))
  with check (public.has_claim_access(claim_id, 'finanzen', 'write'));

create policy claim_payments_delete on public.claim_payments
  for delete to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'));


-- ---------------------------------------------------------------- claim_payment_allocations
alter table public.claim_payment_allocations enable row level security;

drop policy if exists "claim_payment_allocations_owner_all" on public.claim_payment_allocations;
drop policy if exists "claim_payment_allocations_shared_all" on public.claim_payment_allocations;
drop policy if exists "shared_users_delete" on public.claim_payment_allocations;
drop policy if exists "shared_users_insert" on public.claim_payment_allocations;
drop policy if exists "shared_users_select" on public.claim_payment_allocations;
drop policy if exists "shared_users_update" on public.claim_payment_allocations;
drop policy if exists claim_payment_allocations_select on public.claim_payment_allocations;
drop policy if exists claim_payment_allocations_insert on public.claim_payment_allocations;
drop policy if exists claim_payment_allocations_update on public.claim_payment_allocations;
drop policy if exists claim_payment_allocations_delete on public.claim_payment_allocations;

create policy claim_payment_allocations_select on public.claim_payment_allocations
  for select to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'read'));

create policy claim_payment_allocations_insert on public.claim_payment_allocations
  for insert to authenticated
  with check (
    public.has_claim_access(claim_id, 'finanzen', 'write')
    and public.rls_user_ok(user_id, 'claim', claim_id)
  );

create policy claim_payment_allocations_update on public.claim_payment_allocations
  for update to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'))
  with check (public.has_claim_access(claim_id, 'finanzen', 'write'));

create policy claim_payment_allocations_delete on public.claim_payment_allocations
  for delete to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'));


-- ---------------------------------------------------------------- payment_plans
alter table public.payment_plans enable row level security;

drop policy if exists "payment_plans_owner_all" on public.payment_plans;
drop policy if exists "payment_plans_shared_all" on public.payment_plans;
drop policy if exists "shared_users_delete" on public.payment_plans;
drop policy if exists "shared_users_insert" on public.payment_plans;
drop policy if exists "shared_users_select" on public.payment_plans;
drop policy if exists "shared_users_update" on public.payment_plans;
drop policy if exists payment_plans_select on public.payment_plans;
drop policy if exists payment_plans_insert on public.payment_plans;
drop policy if exists payment_plans_update on public.payment_plans;
drop policy if exists payment_plans_delete on public.payment_plans;

create policy payment_plans_select on public.payment_plans
  for select to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'read'));

create policy payment_plans_insert on public.payment_plans
  for insert to authenticated
  with check (
    public.has_claim_access(claim_id, 'finanzen', 'write')
    and public.rls_user_ok(user_id, 'claim', claim_id)
  );

create policy payment_plans_update on public.payment_plans
  for update to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'))
  with check (public.has_claim_access(claim_id, 'finanzen', 'write'));

create policy payment_plans_delete on public.payment_plans
  for delete to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'));


-- ---------------------------------------------------------------- payment_plan_installments
-- Forderung über den Ratenplan (Unterabfrage unter RLS von payment_plans).
alter table public.payment_plan_installments enable row level security;

drop policy if exists "payment_plan_installments_owner_all" on public.payment_plan_installments;
drop policy if exists "payment_plan_installments_shared_all" on public.payment_plan_installments;
drop policy if exists "shared_users_delete" on public.payment_plan_installments;
drop policy if exists "shared_users_insert" on public.payment_plan_installments;
drop policy if exists "shared_users_select" on public.payment_plan_installments;
drop policy if exists "shared_users_update" on public.payment_plan_installments;
drop policy if exists payment_plan_installments_select on public.payment_plan_installments;
drop policy if exists payment_plan_installments_insert on public.payment_plan_installments;
drop policy if exists payment_plan_installments_update on public.payment_plan_installments;
drop policy if exists payment_plan_installments_delete on public.payment_plan_installments;

create policy payment_plan_installments_select on public.payment_plan_installments
  for select to authenticated
  using (exists (select 1 from public.payment_plans pp
                 where pp.id = payment_plan_installments.payment_plan_id
                   and public.has_claim_access(pp.claim_id, 'finanzen', 'read')));

create policy payment_plan_installments_insert on public.payment_plan_installments
  for insert to authenticated
  with check (exists (select 1 from public.payment_plans pp
                      where pp.id = payment_plan_installments.payment_plan_id
                        and public.has_claim_access(pp.claim_id, 'finanzen', 'write')
                        and public.rls_user_ok(payment_plan_installments.user_id, 'claim', pp.claim_id)));

create policy payment_plan_installments_update on public.payment_plan_installments
  for update to authenticated
  using (exists (select 1 from public.payment_plans pp
                 where pp.id = payment_plan_installments.payment_plan_id
                   and public.has_claim_access(pp.claim_id, 'finanzen', 'write')))
  with check (exists (select 1 from public.payment_plans pp
                      where pp.id = payment_plan_installments.payment_plan_id
                        and public.has_claim_access(pp.claim_id, 'finanzen', 'write')));

create policy payment_plan_installments_delete on public.payment_plan_installments
  for delete to authenticated
  using (exists (select 1 from public.payment_plans pp
                 where pp.id = payment_plan_installments.payment_plan_id
                   and public.has_claim_access(pp.claim_id, 'finanzen', 'write')));


-- ---------------------------------------------------------------- payment_plan_requests
-- Anfragen des Mieters entstehen über submit_public_payment_plan_request (RPC).
alter table public.payment_plan_requests enable row level security;

drop policy if exists "Users can manage payment plan requests for their portfolios" on public.payment_plan_requests;
drop policy if exists "shared_users_delete" on public.payment_plan_requests;
drop policy if exists "shared_users_insert" on public.payment_plan_requests;
drop policy if exists "shared_users_select" on public.payment_plan_requests;
drop policy if exists "shared_users_update" on public.payment_plan_requests;
drop policy if exists payment_plan_requests_select on public.payment_plan_requests;
drop policy if exists payment_plan_requests_insert on public.payment_plan_requests;
drop policy if exists payment_plan_requests_update on public.payment_plan_requests;
drop policy if exists payment_plan_requests_delete on public.payment_plan_requests;

create policy payment_plan_requests_select on public.payment_plan_requests
  for select to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'read'));

create policy payment_plan_requests_insert on public.payment_plan_requests
  for insert to authenticated
  with check (public.has_claim_access(claim_id, 'finanzen', 'write'));

create policy payment_plan_requests_update on public.payment_plan_requests
  for update to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'))
  with check (public.has_claim_access(claim_id, 'finanzen', 'write'));

create policy payment_plan_requests_delete on public.payment_plan_requests
  for delete to authenticated
  using (public.has_claim_access(claim_id, 'finanzen', 'write'));


-- =============================================================================
-- 5. Nebenkosten: utility_settlements, distribution_keys, expense_categories
-- =============================================================================

-- ---------------------------------------------------------------- utility_settlements
-- Bezug: Objekt, sonst Wirtschaftseinheit, sonst nur der eigene Nutzer.
alter table public.utility_settlements enable row level security;

drop policy if exists "shared_users_access" on public.utility_settlements;
drop policy if exists "Users can delete own settlements" on public.utility_settlements;
drop policy if exists "Users can insert own settlements" on public.utility_settlements;
drop policy if exists "Users can view own settlements" on public.utility_settlements;
drop policy if exists "Users can update own settlements" on public.utility_settlements;
drop policy if exists utility_settlements_select on public.utility_settlements;
drop policy if exists utility_settlements_insert on public.utility_settlements;
drop policy if exists utility_settlements_update on public.utility_settlements;
drop policy if exists utility_settlements_delete on public.utility_settlements;

create policy utility_settlements_select on public.utility_settlements
  for select to authenticated
  using (
    case
      when property_id is not null then public.has_property_access(property_id, 'nebenkosten', 'read')
      when economic_unit_id is not null then public.has_economic_unit_access(economic_unit_id, 'nebenkosten', 'read')
      else user_id = (select auth.uid())
    end
  );

create policy utility_settlements_insert on public.utility_settlements
  for insert to authenticated
  with check (
    case
      when property_id is not null then
        public.has_property_access(property_id, 'nebenkosten', 'write')
        and public.rls_user_ok(user_id, 'property', property_id)
      when economic_unit_id is not null then
        public.has_economic_unit_access(economic_unit_id, 'nebenkosten', 'write')
        and public.rls_user_ok(user_id, 'economic_unit', economic_unit_id)
      else user_id = (select auth.uid())
    end
    and (economic_unit_id is null
         or public.has_economic_unit_access(economic_unit_id, 'nebenkosten', 'write'))
  );

create policy utility_settlements_update on public.utility_settlements
  for update to authenticated
  using (
    case
      when property_id is not null then public.has_property_access(property_id, 'nebenkosten', 'write')
      when economic_unit_id is not null then public.has_economic_unit_access(economic_unit_id, 'nebenkosten', 'write')
      else user_id = (select auth.uid())
    end
  )
  with check (
    case
      when property_id is not null then public.has_property_access(property_id, 'nebenkosten', 'write')
      when economic_unit_id is not null then public.has_economic_unit_access(economic_unit_id, 'nebenkosten', 'write')
      else user_id = (select auth.uid())
    end
    and (economic_unit_id is null
         or public.has_economic_unit_access(economic_unit_id, 'nebenkosten', 'write'))
  );

create policy utility_settlements_delete on public.utility_settlements
  for delete to authenticated
  using (
    case
      when property_id is not null then public.has_property_access(property_id, 'nebenkosten', 'write')
      when economic_unit_id is not null then public.has_economic_unit_access(economic_unit_id, 'nebenkosten', 'write')
      else user_id = (select auth.uid())
    end
  );


-- ---------------------------------------------------------------- distribution_keys
-- Standard-Schlüssel (user_id IS NULL) für alle lesbar; Ändern/Löschen nur Eigentümer.
alter table public.distribution_keys enable row level security;

drop policy if exists "Users can delete their own keys" on public.distribution_keys;
drop policy if exists "Users can insert their own keys" on public.distribution_keys;
drop policy if exists "shared_users_insert" on public.distribution_keys;
drop policy if exists "Users can view their own keys and standard keys" on public.distribution_keys;
drop policy if exists "shared_users_select" on public.distribution_keys;
drop policy if exists "Users can update their own keys" on public.distribution_keys;
drop policy if exists distribution_keys_select on public.distribution_keys;
drop policy if exists distribution_keys_insert on public.distribution_keys;
drop policy if exists distribution_keys_update on public.distribution_keys;
drop policy if exists distribution_keys_delete on public.distribution_keys;

create policy distribution_keys_select on public.distribution_keys
  for select to authenticated
  using (
    user_id is null
    or user_id = (select auth.uid())
    or public.rls_owner_shares(user_id, '*', 'read')
  );

create policy distribution_keys_insert on public.distribution_keys
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or public.rls_owner_shares(user_id, 'nebenkosten', 'write')
  );

create policy distribution_keys_update on public.distribution_keys
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy distribution_keys_delete on public.distribution_keys
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- ---------------------------------------------------------------- expense_categories
alter table public.expense_categories enable row level security;

drop policy if exists "expense_categories_own_all" on public.expense_categories;
drop policy if exists "Users can delete their own categories" on public.expense_categories;
drop policy if exists "Users can insert their own categories" on public.expense_categories;
drop policy if exists "shared_users_insert" on public.expense_categories;
drop policy if exists "Users can view their own and standard categories" on public.expense_categories;
drop policy if exists "shared_users_select" on public.expense_categories;
drop policy if exists "Users can update their own categories" on public.expense_categories;
drop policy if exists expense_categories_select on public.expense_categories;
drop policy if exists expense_categories_insert on public.expense_categories;
drop policy if exists expense_categories_update on public.expense_categories;
drop policy if exists expense_categories_delete on public.expense_categories;

create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (
    user_id is null
    or user_id = (select auth.uid())
    or public.rls_owner_shares(user_id, '*', 'read')
  );

create policy expense_categories_insert on public.expense_categories
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or public.rls_owner_shares(user_id, 'nebenkosten', 'write')
  );

create policy expense_categories_update on public.expense_categories
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy expense_categories_delete on public.expense_categories
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- =============================================================================
-- 6. Zähler: meters, meter_readings
-- =============================================================================

-- ---------------------------------------------------------------- meters
alter table public.meters enable row level security;

drop policy if exists "shared_users_access" on public.meters;
drop policy if exists "Users can delete their own meters" on public.meters;
drop policy if exists "Users can insert their own meters" on public.meters;
drop policy if exists "Users can view their own meters" on public.meters;
drop policy if exists "Users can update their own meters" on public.meters;
drop policy if exists meters_select on public.meters;
drop policy if exists meters_insert on public.meters;
drop policy if exists meters_update on public.meters;
drop policy if exists meters_delete on public.meters;

create policy meters_select on public.meters
  for select to authenticated
  using (public.has_portfolio_access(portfolio_id, 'zaehler', 'read'));

create policy meters_insert on public.meters
  for insert to authenticated
  with check (
    public.has_portfolio_access(portfolio_id, 'zaehler', 'write')
    and public.has_property_access(property_id, 'zaehler', 'write')
    and (unit_id is null or public.has_unit_access(unit_id, 'zaehler', 'write'))
    and public.rls_user_ok(user_id, 'portfolio', portfolio_id)
  );

create policy meters_update on public.meters
  for update to authenticated
  using (public.has_portfolio_access(portfolio_id, 'zaehler', 'write'))
  with check (
    public.has_portfolio_access(portfolio_id, 'zaehler', 'write')
    and public.has_property_access(property_id, 'zaehler', 'write')
    and (unit_id is null or public.has_unit_access(unit_id, 'zaehler', 'write'))
  );

create policy meters_delete on public.meters
  for delete to authenticated
  using (public.has_portfolio_access(portfolio_id, 'zaehler', 'write'));


-- ---------------------------------------------------------------- meter_readings
-- Ablesung nur für einen Zähler desselben Portfolios (sonst schreibt der Trigger
-- update_meter_last_reading in einen fremden Zähler).
alter table public.meter_readings enable row level security;

drop policy if exists "shared_users_access" on public.meter_readings;
drop policy if exists "Users can delete their own meter readings" on public.meter_readings;
drop policy if exists "Users can insert their own meter readings" on public.meter_readings;
drop policy if exists "Users can view their own meter readings" on public.meter_readings;
drop policy if exists "Users can update their own meter readings" on public.meter_readings;
drop policy if exists meter_readings_select on public.meter_readings;
drop policy if exists meter_readings_insert on public.meter_readings;
drop policy if exists meter_readings_update on public.meter_readings;
drop policy if exists meter_readings_delete on public.meter_readings;

create policy meter_readings_select on public.meter_readings
  for select to authenticated
  using (public.has_portfolio_access(portfolio_id, 'zaehler', 'read'));

create policy meter_readings_insert on public.meter_readings
  for insert to authenticated
  with check (
    public.has_portfolio_access(portfolio_id, 'zaehler', 'write')
    and exists (select 1 from public.meters m
                where m.id = meter_readings.meter_id
                  and m.portfolio_id = meter_readings.portfolio_id)
    and public.rls_user_ok(user_id, 'portfolio', portfolio_id)
  );

create policy meter_readings_update on public.meter_readings
  for update to authenticated
  using (public.has_portfolio_access(portfolio_id, 'zaehler', 'write'))
  with check (
    public.has_portfolio_access(portfolio_id, 'zaehler', 'write')
    and exists (select 1 from public.meters m
                where m.id = meter_readings.meter_id
                  and m.portfolio_id = meter_readings.portfolio_id)
  );

create policy meter_readings_delete on public.meter_readings
  for delete to authenticated
  using (public.has_portfolio_access(portfolio_id, 'zaehler', 'write'));


-- =============================================================================
-- 7. Kontakte (Befund 4.9: tenant_id nur Mieter desselben Kontakt-Eigentümers)
-- =============================================================================
alter table public.contacts enable row level security;

drop policy if exists "contacts_owner_all" on public.contacts;
drop policy if exists "shared_users_insert" on public.contacts;
drop policy if exists "shared_users_select" on public.contacts;
drop policy if exists contacts_select on public.contacts;
drop policy if exists contacts_insert on public.contacts;
drop policy if exists contacts_update on public.contacts;
drop policy if exists contacts_delete on public.contacts;

-- Lesen: eigener Kontakt; Freigabe "kontakte" des Eigentümers (Mieter-Kontakte nur,
-- wenn der Mieter in einem freigegebenen Portfolio wohnt); außerdem Kontakte, die
-- an einer lesbaren Rechnung bzw. einem lesbaren Sanierungsgewerk hängen.
-- Altdaten, deren Mieter einem anderen Nutzer gehört (4.9), werden nur nach der
-- Freigabe des Kontakt-Eigentümers gezeigt – nie dem Eigentümer des fremden Mieters.
create policy contacts_select on public.contacts
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (tenant_id is null and public.rls_owner_shares(user_id, 'kontakte', 'read'))
    or (tenant_id is not null
        and case when public.rls_tenant_ok(tenant_id, 'user', user_id)
                 then public.has_tenant_access(tenant_id, 'kontakte', 'read')
                 else public.rls_owner_shares(user_id, 'kontakte', 'read') end)
    or exists (select 1 from public.invoices i
               where i.contact_id = contacts.id
                 and public.has_portfolio_access(i.portfolio_id, 'finanzen', 'read'))
    or exists (select 1 from public.renovation_project_subtrades s
               where s.responsible_contact_id = contacts.id
                 and (public.has_renovation_project_access(s.project_id, 'immobilien', 'read')
                      or public.has_renovation_project_access(s.project_id, 'investorportal', 'read')))
  );

create policy contacts_insert on public.contacts
  for insert to authenticated
  with check (
    (user_id = (select auth.uid())
     or public.rls_owner_shares(user_id, 'kontakte', 'write'))
    and public.rls_tenant_ok(tenant_id, 'user', user_id)
  );

-- Ändern/Löschen wie bisher nur durch den Eigentümer des Kontakts
create policy contacts_update on public.contacts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (public.rls_tenant_ok(tenant_id, 'user', user_id)
         or public.rls_tenant_link_unchanged('contacts', id, tenant_id))
  );

create policy contacts_delete on public.contacts
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- =============================================================================
-- 8. Immobilien-nahe Daten: documents, floor_plans, objektkalender_*
-- =============================================================================

-- ---------------------------------------------------------------- documents (D3a-06)
alter table public.documents enable row level security;

drop policy if exists "documents_own_all" on public.documents;
drop policy if exists "shared_users_access" on public.documents;
drop policy if exists documents_select on public.documents;
drop policy if exists documents_insert on public.documents;
drop policy if exists documents_update on public.documents;
drop policy if exists documents_delete on public.documents;
-- bleiben: tenants_read_general_docs, tenants_read_personal_docs

create policy documents_select on public.documents
  for select to authenticated
  using (
    case
      when property_id is not null then
        public.has_property_access(property_id, 'immobilien', 'read')
        or public.has_property_access(property_id, 'mieterportal', 'read')
      when unit_id is not null then
        public.has_unit_access(unit_id, 'immobilien', 'read')
        or public.has_unit_access(unit_id, 'mieterportal', 'read')
      else user_id = (select auth.uid())
    end
  );

create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    case
      when property_id is not null then
        (public.has_property_access(property_id, 'immobilien', 'write')
         or public.has_property_access(property_id, 'mieterportal', 'write'))
        and public.rls_user_ok(user_id, 'property', property_id)
      when unit_id is not null then
        (public.has_unit_access(unit_id, 'immobilien', 'write')
         or public.has_unit_access(unit_id, 'mieterportal', 'write'))
        and public.rls_user_ok(user_id, 'unit', unit_id)
      else user_id = (select auth.uid())
    end
    and (unit_id is null
         or public.has_unit_access(unit_id, 'immobilien', 'write')
         or public.has_unit_access(unit_id, 'mieterportal', 'write'))
    and public.rls_tenant_ok(
          tenant_id,
          case when property_id is not null then 'property'
               when unit_id is not null then 'unit'
               else 'user' end,
          coalesce(property_id, unit_id, user_id))
  );

create policy documents_update on public.documents
  for update to authenticated
  using (
    case
      when property_id is not null then
        public.has_property_access(property_id, 'immobilien', 'write')
        or public.has_property_access(property_id, 'mieterportal', 'write')
      when unit_id is not null then
        public.has_unit_access(unit_id, 'immobilien', 'write')
        or public.has_unit_access(unit_id, 'mieterportal', 'write')
      else user_id = (select auth.uid())
    end
  )
  with check (
    case
      when property_id is not null then
        public.has_property_access(property_id, 'immobilien', 'write')
        or public.has_property_access(property_id, 'mieterportal', 'write')
      when unit_id is not null then
        public.has_unit_access(unit_id, 'immobilien', 'write')
        or public.has_unit_access(unit_id, 'mieterportal', 'write')
      else user_id = (select auth.uid())
    end
    and (unit_id is null
         or public.has_unit_access(unit_id, 'immobilien', 'write')
         or public.has_unit_access(unit_id, 'mieterportal', 'write'))
    and (public.rls_tenant_ok(
           tenant_id,
           case when property_id is not null then 'property'
                when unit_id is not null then 'unit'
                else 'user' end,
           coalesce(property_id, unit_id, user_id))
         or public.rls_tenant_link_unchanged('documents', id, tenant_id))
  );

create policy documents_delete on public.documents
  for delete to authenticated
  using (
    case
      when property_id is not null then
        public.has_property_access(property_id, 'immobilien', 'write')
        or public.has_property_access(property_id, 'mieterportal', 'write')
      when unit_id is not null then
        public.has_unit_access(unit_id, 'immobilien', 'write')
        or public.has_unit_access(unit_id, 'mieterportal', 'write')
      else user_id = (select auth.uid())
    end
  );


-- ---------------------------------------------------------------- floor_plans
alter table public.floor_plans enable row level security;

drop policy if exists "shared_users_access" on public.floor_plans;
drop policy if exists "Users can delete their own floor plans" on public.floor_plans;
drop policy if exists "Users can insert their own floor plans" on public.floor_plans;
drop policy if exists "Users can view their own floor plans" on public.floor_plans;
drop policy if exists "Users can update their own floor plans" on public.floor_plans;
drop policy if exists floor_plans_select on public.floor_plans;
drop policy if exists floor_plans_insert on public.floor_plans;
drop policy if exists floor_plans_update on public.floor_plans;
drop policy if exists floor_plans_delete on public.floor_plans;

create policy floor_plans_select on public.floor_plans
  for select to authenticated
  using (
    case
      when property_id is not null then
        public.has_property_access(property_id, 'immobilien', 'read')
        or public.has_property_access(property_id, 'investorportal', 'read')
      when unit_id is not null then
        public.has_unit_access(unit_id, 'immobilien', 'read')
        or public.has_unit_access(unit_id, 'investorportal', 'read')
      else user_id = (select auth.uid())
    end
  );

create policy floor_plans_insert on public.floor_plans
  for insert to authenticated
  with check (
    case
      when property_id is not null then
        (public.has_property_access(property_id, 'immobilien', 'write')
         or public.has_property_access(property_id, 'investorportal', 'write'))
        and public.rls_user_ok(user_id, 'property', property_id)
      when unit_id is not null then
        (public.has_unit_access(unit_id, 'immobilien', 'write')
         or public.has_unit_access(unit_id, 'investorportal', 'write'))
        and public.rls_user_ok(user_id, 'unit', unit_id)
      else user_id = (select auth.uid())
    end
    and (unit_id is null
         or public.has_unit_access(unit_id, 'immobilien', 'write')
         or public.has_unit_access(unit_id, 'investorportal', 'write'))
  );

create policy floor_plans_update on public.floor_plans
  for update to authenticated
  using (
    case
      when property_id is not null then
        public.has_property_access(property_id, 'immobilien', 'write')
        or public.has_property_access(property_id, 'investorportal', 'write')
      when unit_id is not null then
        public.has_unit_access(unit_id, 'immobilien', 'write')
        or public.has_unit_access(unit_id, 'investorportal', 'write')
      else user_id = (select auth.uid())
    end
  )
  with check (
    case
      when property_id is not null then
        public.has_property_access(property_id, 'immobilien', 'write')
        or public.has_property_access(property_id, 'investorportal', 'write')
      when unit_id is not null then
        public.has_unit_access(unit_id, 'immobilien', 'write')
        or public.has_unit_access(unit_id, 'investorportal', 'write')
      else user_id = (select auth.uid())
    end
    and (unit_id is null
         or public.has_unit_access(unit_id, 'immobilien', 'write')
         or public.has_unit_access(unit_id, 'investorportal', 'write'))
  );

create policy floor_plans_delete on public.floor_plans
  for delete to authenticated
  using (
    case
      when property_id is not null then
        public.has_property_access(property_id, 'immobilien', 'write')
        or public.has_property_access(property_id, 'investorportal', 'write')
      when unit_id is not null then
        public.has_unit_access(unit_id, 'immobilien', 'write')
        or public.has_unit_access(unit_id, 'investorportal', 'write')
      else user_id = (select auth.uid())
    end
  );


-- ---------------------------------------------------------------- objektkalender_events
alter table public.objektkalender_events enable row level security;

drop policy if exists "ok_users_own_events" on public.objektkalender_events;
drop policy if exists "shared_users_access" on public.objektkalender_events;
drop policy if exists "ok_tenants_update_own_events" on public.objektkalender_events;
drop policy if exists objektkalender_events_select on public.objektkalender_events;
drop policy if exists objektkalender_events_insert on public.objektkalender_events;
drop policy if exists objektkalender_events_update on public.objektkalender_events;
drop policy if exists objektkalender_events_delete on public.objektkalender_events;
-- bleibt: ok_tenants_read_events

create policy objektkalender_events_select on public.objektkalender_events
  for select to authenticated
  using (
    public.has_property_access(property_id, 'immobilien', 'read')
    or public.has_property_access(property_id, 'mieterportal', 'read')
  );

create policy objektkalender_events_insert on public.objektkalender_events
  for insert to authenticated
  with check (
    (public.has_property_access(property_id, 'immobilien', 'write')
     or public.has_property_access(property_id, 'mieterportal', 'write'))
    and (assigned_unit_id is null
         or public.has_unit_access(assigned_unit_id, 'immobilien', 'write')
         or public.has_unit_access(assigned_unit_id, 'mieterportal', 'write'))
    and public.rls_user_ok(user_id, 'property', property_id)
  );

create policy objektkalender_events_update on public.objektkalender_events
  for update to authenticated
  using (
    public.has_property_access(property_id, 'immobilien', 'write')
    or public.has_property_access(property_id, 'mieterportal', 'write')
  )
  with check (
    (public.has_property_access(property_id, 'immobilien', 'write')
     or public.has_property_access(property_id, 'mieterportal', 'write'))
    and (assigned_unit_id is null
         or public.has_unit_access(assigned_unit_id, 'immobilien', 'write')
         or public.has_unit_access(assigned_unit_id, 'mieterportal', 'write'))
  );

create policy objektkalender_events_delete on public.objektkalender_events
  for delete to authenticated
  using (
    public.has_property_access(property_id, 'immobilien', 'write')
    or public.has_property_access(property_id, 'mieterportal', 'write')
  );

-- Mieter: nur Termine der eigenen Einheit als erledigt markieren (Status/Erledigt-
-- Felder); alle übrigen Spalten müssen unverändert bleiben (D3a-15, M1-13).
create policy "ok_tenants_update_own_events" on public.objektkalender_events
  for update to authenticated
  using (exists (select 1 from public.user_roles ur
                 where ur.user_id = (select auth.uid())
                   and ur.role = 'tenant'
                   and ur.property_id = objektkalender_events.property_id
                   and ur.unit_id = objektkalender_events.assigned_unit_id))
  with check (
    exists (select 1 from public.user_roles ur
            where ur.user_id = (select auth.uid())
              and ur.role = 'tenant'
              and ur.property_id = objektkalender_events.property_id
              and ur.unit_id = objektkalender_events.assigned_unit_id)
    and status in ('pending', 'done')
    and (completed_by is null or completed_by = (select auth.uid()))
    and public.rls_ok_event_core_unchanged(
          id, user_id, property_id, event_type, title, color, event_date, recurring,
          recurrence_rule, recurring_end_date, assigned_unit_id, assigned_unit_name,
          waste_type, push_enabled)
  );


-- ---------------------------------------------------------------- objektkalender_history
alter table public.objektkalender_history enable row level security;

drop policy if exists "ok_users_own_history" on public.objektkalender_history;
drop policy if exists "shared_users_access" on public.objektkalender_history;
drop policy if exists "ok_tenants_insert_history" on public.objektkalender_history;
drop policy if exists objektkalender_history_select on public.objektkalender_history;
drop policy if exists objektkalender_history_insert on public.objektkalender_history;
drop policy if exists objektkalender_history_update on public.objektkalender_history;
drop policy if exists objektkalender_history_delete on public.objektkalender_history;
-- bleibt: ok_tenants_read_history

create policy objektkalender_history_select on public.objektkalender_history
  for select to authenticated
  using (
    public.has_property_access(property_id, 'immobilien', 'read')
    or public.has_property_access(property_id, 'mieterportal', 'read')
  );

create policy objektkalender_history_insert on public.objektkalender_history
  for insert to authenticated
  with check (
    (public.has_property_access(property_id, 'immobilien', 'write')
     or public.has_property_access(property_id, 'mieterportal', 'write'))
    and public.rls_user_ok(user_id, 'property', property_id)
    and (event_id is null
         or exists (select 1 from public.objektkalender_events e
                    where e.id = objektkalender_history.event_id
                      and e.property_id = objektkalender_history.property_id))
  );

create policy objektkalender_history_update on public.objektkalender_history
  for update to authenticated
  using (
    public.has_property_access(property_id, 'immobilien', 'write')
    or public.has_property_access(property_id, 'mieterportal', 'write')
  )
  with check (
    public.has_property_access(property_id, 'immobilien', 'write')
    or public.has_property_access(property_id, 'mieterportal', 'write')
  );

create policy objektkalender_history_delete on public.objektkalender_history
  for delete to authenticated
  using (
    public.has_property_access(property_id, 'immobilien', 'write')
    or public.has_property_access(property_id, 'mieterportal', 'write')
  );

-- Mieter: Verlaufseintrag nur zu einem Termin der eigenen Einheit (D3a-14, M1-13)
create policy "ok_tenants_insert_history" on public.objektkalender_history
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (completed_by is null or completed_by = (select auth.uid()))
    and exists (select 1 from public.objektkalender_events e
                join public.user_roles ur
                  on ur.property_id = e.property_id
                 and ur.unit_id = e.assigned_unit_id
                where e.id = objektkalender_history.event_id
                  and e.property_id = objektkalender_history.property_id
                  and ur.user_id = (select auth.uid())
                  and ur.role = 'tenant')
  );


-- ---------------------------------------------------------------- objektkalender_settings
alter table public.objektkalender_settings enable row level security;

drop policy if exists "ok_users_own_settings" on public.objektkalender_settings;
drop policy if exists "shared_users_access" on public.objektkalender_settings;
drop policy if exists objektkalender_settings_select on public.objektkalender_settings;
drop policy if exists objektkalender_settings_insert on public.objektkalender_settings;
drop policy if exists objektkalender_settings_update on public.objektkalender_settings;
drop policy if exists objektkalender_settings_delete on public.objektkalender_settings;
-- bleibt: ok_tenants_read_settings

create policy objektkalender_settings_select on public.objektkalender_settings
  for select to authenticated
  using (
    public.has_property_access(property_id, 'immobilien', 'read')
    or public.has_property_access(property_id, 'mieterportal', 'read')
  );

create policy objektkalender_settings_insert on public.objektkalender_settings
  for insert to authenticated
  with check (
    (public.has_property_access(property_id, 'immobilien', 'write')
     or public.has_property_access(property_id, 'mieterportal', 'write'))
    and public.rls_user_ok(user_id, 'property', property_id)
  );

create policy objektkalender_settings_update on public.objektkalender_settings
  for update to authenticated
  using (
    public.has_property_access(property_id, 'immobilien', 'write')
    or public.has_property_access(property_id, 'mieterportal', 'write')
  )
  with check (
    public.has_property_access(property_id, 'immobilien', 'write')
    or public.has_property_access(property_id, 'mieterportal', 'write')
  );

create policy objektkalender_settings_delete on public.objektkalender_settings
  for delete to authenticated
  using (
    public.has_property_access(property_id, 'immobilien', 'write')
    or public.has_property_access(property_id, 'mieterportal', 'write')
  );


