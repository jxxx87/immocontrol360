-- =============================================================================
-- 9. Vorlagen: document_templates (D3a-05), pdf_templates (D3a-07)
--    Lesen '*' (jede Freigabe), Schreiben nur der Portfolio-Eigentümer;
--    globale Vorlagen (portfolio_id IS NULL) nur der eigene Nutzer.
-- =============================================================================

-- ---------------------------------------------------------------- document_templates
alter table public.document_templates enable row level security;

drop policy if exists "manage_document_template_policy" on public.document_templates;
drop policy if exists document_templates_select on public.document_templates;
drop policy if exists document_templates_insert on public.document_templates;
drop policy if exists document_templates_update on public.document_templates;
drop policy if exists document_templates_delete on public.document_templates;

create policy document_templates_select on public.document_templates
  for select to authenticated
  using (
    case when portfolio_id is null then user_id = (select auth.uid())
         else public.has_portfolio_access(portfolio_id, '*', 'read') end
  );

create policy document_templates_insert on public.document_templates
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (portfolio_id is null or public.rls_is_portfolio_owner(portfolio_id))
  );

create policy document_templates_update on public.document_templates
  for update to authenticated
  using (
    case when portfolio_id is null then user_id = (select auth.uid())
         else public.rls_is_portfolio_owner(portfolio_id) end
  )
  with check (
    user_id = (select auth.uid())
    and (portfolio_id is null or public.rls_is_portfolio_owner(portfolio_id))
  );

create policy document_templates_delete on public.document_templates
  for delete to authenticated
  using (
    case when portfolio_id is null then user_id = (select auth.uid())
         else public.rls_is_portfolio_owner(portfolio_id) end
  );


-- ---------------------------------------------------------------- pdf_templates
alter table public.pdf_templates enable row level security;

drop policy if exists "Users can manage pdf_templates for their portfolios" on public.pdf_templates;
drop policy if exists "shared_users_access" on public.pdf_templates;
drop policy if exists pdf_templates_select on public.pdf_templates;
drop policy if exists pdf_templates_insert on public.pdf_templates;
drop policy if exists pdf_templates_update on public.pdf_templates;
drop policy if exists pdf_templates_delete on public.pdf_templates;

create policy pdf_templates_select on public.pdf_templates
  for select to authenticated
  using (public.has_portfolio_access(portfolio_id, '*', 'read'));

create policy pdf_templates_insert on public.pdf_templates
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.rls_is_portfolio_owner(portfolio_id)
  );

create policy pdf_templates_update on public.pdf_templates
  for update to authenticated
  using (public.rls_is_portfolio_owner(portfolio_id))
  with check (public.rls_is_portfolio_owner(portfolio_id));

create policy pdf_templates_delete on public.pdf_templates
  for delete to authenticated
  using (public.rls_is_portfolio_owner(portfolio_id));


-- =============================================================================
-- 10. Sanierung (immobilien|investorportal)
-- =============================================================================

-- ---------------------------------------------------------------- renovation_projects
-- Lesen auch für den Ersteller (wie has_renovation_project_access im Fundament).
alter table public.renovation_projects enable row level security;

drop policy if exists "Users manage own renovation_projects" on public.renovation_projects;
drop policy if exists "shared_users_access" on public.renovation_projects;
drop policy if exists renovation_projects_select on public.renovation_projects;
drop policy if exists renovation_projects_insert on public.renovation_projects;
drop policy if exists renovation_projects_update on public.renovation_projects;
drop policy if exists renovation_projects_delete on public.renovation_projects;

create policy renovation_projects_select on public.renovation_projects
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_property_access(property_id, 'immobilien', 'read')
    or public.has_property_access(property_id, 'investorportal', 'read')
  );

create policy renovation_projects_insert on public.renovation_projects
  for insert to authenticated
  with check (
    (public.has_property_access(property_id, 'immobilien', 'write')
     or public.has_property_access(property_id, 'investorportal', 'write'))
    and (unit_id is null
         or public.has_unit_access(unit_id, 'immobilien', 'write')
         or public.has_unit_access(unit_id, 'investorportal', 'write'))
    and public.rls_user_ok(user_id, 'property', property_id)
  );

create policy renovation_projects_update on public.renovation_projects
  for update to authenticated
  using (
    public.has_property_access(property_id, 'immobilien', 'write')
    or public.has_property_access(property_id, 'investorportal', 'write')
  )
  with check (
    (public.has_property_access(property_id, 'immobilien', 'write')
     or public.has_property_access(property_id, 'investorportal', 'write'))
    and (unit_id is null
         or public.has_unit_access(unit_id, 'immobilien', 'write')
         or public.has_unit_access(unit_id, 'investorportal', 'write'))
  );

create policy renovation_projects_delete on public.renovation_projects
  for delete to authenticated
  using (
    public.has_property_access(property_id, 'immobilien', 'write')
    or public.has_property_access(property_id, 'investorportal', 'write')
  );


-- ---------------------------------------------------------------- renovation_project_trades
alter table public.renovation_project_trades enable row level security;

drop policy if exists "Users manage own renovation_project_trades" on public.renovation_project_trades;
drop policy if exists "shared_users_delete" on public.renovation_project_trades;
drop policy if exists "shared_users_insert" on public.renovation_project_trades;
drop policy if exists "shared_users_select" on public.renovation_project_trades;
drop policy if exists "shared_users_update" on public.renovation_project_trades;
drop policy if exists renovation_project_trades_select on public.renovation_project_trades;
drop policy if exists renovation_project_trades_insert on public.renovation_project_trades;
drop policy if exists renovation_project_trades_update on public.renovation_project_trades;
drop policy if exists renovation_project_trades_delete on public.renovation_project_trades;

create policy renovation_project_trades_select on public.renovation_project_trades
  for select to authenticated
  using (
    public.has_renovation_project_access(project_id, 'immobilien', 'read')
    or public.has_renovation_project_access(project_id, 'investorportal', 'read')
  );

create policy renovation_project_trades_insert on public.renovation_project_trades
  for insert to authenticated
  with check (
    (public.has_renovation_project_access(project_id, 'immobilien', 'write')
     or public.has_renovation_project_access(project_id, 'investorportal', 'write'))
    and public.rls_user_ok(user_id, 'renovation_project', project_id)
  );

create policy renovation_project_trades_update on public.renovation_project_trades
  for update to authenticated
  using (
    public.has_renovation_project_access(project_id, 'immobilien', 'write')
    or public.has_renovation_project_access(project_id, 'investorportal', 'write')
  )
  with check (
    public.has_renovation_project_access(project_id, 'immobilien', 'write')
    or public.has_renovation_project_access(project_id, 'investorportal', 'write')
  );

create policy renovation_project_trades_delete on public.renovation_project_trades
  for delete to authenticated
  using (
    public.has_renovation_project_access(project_id, 'immobilien', 'write')
    or public.has_renovation_project_access(project_id, 'investorportal', 'write')
  );


-- ---------------------------------------------------------------- renovation_project_subtrades
alter table public.renovation_project_subtrades enable row level security;

drop policy if exists "Users manage own renovation_project_subtrades" on public.renovation_project_subtrades;
drop policy if exists "shared_users_delete" on public.renovation_project_subtrades;
drop policy if exists "shared_users_insert" on public.renovation_project_subtrades;
drop policy if exists "shared_users_select" on public.renovation_project_subtrades;
drop policy if exists "shared_users_update" on public.renovation_project_subtrades;
drop policy if exists renovation_project_subtrades_select on public.renovation_project_subtrades;
drop policy if exists renovation_project_subtrades_insert on public.renovation_project_subtrades;
drop policy if exists renovation_project_subtrades_update on public.renovation_project_subtrades;
drop policy if exists renovation_project_subtrades_delete on public.renovation_project_subtrades;

create policy renovation_project_subtrades_select on public.renovation_project_subtrades
  for select to authenticated
  using (
    public.has_renovation_project_access(project_id, 'immobilien', 'read')
    or public.has_renovation_project_access(project_id, 'investorportal', 'read')
  );

create policy renovation_project_subtrades_insert on public.renovation_project_subtrades
  for insert to authenticated
  with check (
    (public.has_renovation_project_access(project_id, 'immobilien', 'write')
     or public.has_renovation_project_access(project_id, 'investorportal', 'write'))
    and exists (select 1 from public.renovation_project_trades t
                where t.id = renovation_project_subtrades.project_trade_id
                  and t.project_id = renovation_project_subtrades.project_id)
    and public.rls_user_ok(user_id, 'renovation_project', project_id)
  );

create policy renovation_project_subtrades_update on public.renovation_project_subtrades
  for update to authenticated
  using (
    public.has_renovation_project_access(project_id, 'immobilien', 'write')
    or public.has_renovation_project_access(project_id, 'investorportal', 'write')
  )
  with check (
    (public.has_renovation_project_access(project_id, 'immobilien', 'write')
     or public.has_renovation_project_access(project_id, 'investorportal', 'write'))
    and exists (select 1 from public.renovation_project_trades t
                where t.id = renovation_project_subtrades.project_trade_id
                  and t.project_id = renovation_project_subtrades.project_id)
  );

create policy renovation_project_subtrades_delete on public.renovation_project_subtrades
  for delete to authenticated
  using (
    public.has_renovation_project_access(project_id, 'immobilien', 'write')
    or public.has_renovation_project_access(project_id, 'investorportal', 'write')
  );


-- ---------------------------------------------------------------- renovation_invoices
alter table public.renovation_invoices enable row level security;

drop policy if exists "Users manage own renovation_invoices" on public.renovation_invoices;
drop policy if exists "shared_users_delete" on public.renovation_invoices;
drop policy if exists "shared_users_insert" on public.renovation_invoices;
drop policy if exists "shared_users_select" on public.renovation_invoices;
drop policy if exists "shared_users_update" on public.renovation_invoices;
drop policy if exists renovation_invoices_select on public.renovation_invoices;
drop policy if exists renovation_invoices_insert on public.renovation_invoices;
drop policy if exists renovation_invoices_update on public.renovation_invoices;
drop policy if exists renovation_invoices_delete on public.renovation_invoices;

create policy renovation_invoices_select on public.renovation_invoices
  for select to authenticated
  using (
    public.has_renovation_project_access(project_id, 'immobilien', 'read')
    or public.has_renovation_project_access(project_id, 'investorportal', 'read')
  );

create policy renovation_invoices_insert on public.renovation_invoices
  for insert to authenticated
  with check (
    (public.has_renovation_project_access(project_id, 'immobilien', 'write')
     or public.has_renovation_project_access(project_id, 'investorportal', 'write'))
    and exists (select 1 from public.renovation_project_subtrades s
                where s.id = renovation_invoices.project_subtrade_id
                  and s.project_id = renovation_invoices.project_id)
    and public.rls_user_ok(user_id, 'renovation_project', project_id)
  );

create policy renovation_invoices_update on public.renovation_invoices
  for update to authenticated
  using (
    public.has_renovation_project_access(project_id, 'immobilien', 'write')
    or public.has_renovation_project_access(project_id, 'investorportal', 'write')
  )
  with check (
    (public.has_renovation_project_access(project_id, 'immobilien', 'write')
     or public.has_renovation_project_access(project_id, 'investorportal', 'write'))
    and exists (select 1 from public.renovation_project_subtrades s
                where s.id = renovation_invoices.project_subtrade_id
                  and s.project_id = renovation_invoices.project_id)
  );

create policy renovation_invoices_delete on public.renovation_invoices
  for delete to authenticated
  using (
    public.has_renovation_project_access(project_id, 'immobilien', 'write')
    or public.has_renovation_project_access(project_id, 'investorportal', 'write')
  );


-- ---------------------------------------------------------------- renovation_milestones
-- Projekt über das Gewerk (Unterabfrage unter RLS von renovation_project_trades).
alter table public.renovation_milestones enable row level security;

drop policy if exists "Users manage own renovation_milestones" on public.renovation_milestones;
drop policy if exists "shared_users_delete" on public.renovation_milestones;
drop policy if exists "shared_users_insert" on public.renovation_milestones;
drop policy if exists "shared_users_select" on public.renovation_milestones;
drop policy if exists "shared_users_update" on public.renovation_milestones;
drop policy if exists renovation_milestones_select on public.renovation_milestones;
drop policy if exists renovation_milestones_insert on public.renovation_milestones;
drop policy if exists renovation_milestones_update on public.renovation_milestones;
drop policy if exists renovation_milestones_delete on public.renovation_milestones;

create policy renovation_milestones_select on public.renovation_milestones
  for select to authenticated
  using (exists (select 1 from public.renovation_project_trades t
                 where t.id = renovation_milestones.project_trade_id
                   and (public.has_renovation_project_access(t.project_id, 'immobilien', 'read')
                        or public.has_renovation_project_access(t.project_id, 'investorportal', 'read'))));

create policy renovation_milestones_insert on public.renovation_milestones
  for insert to authenticated
  with check (exists (select 1 from public.renovation_project_trades t
                      where t.id = renovation_milestones.project_trade_id
                        and (public.has_renovation_project_access(t.project_id, 'immobilien', 'write')
                             or public.has_renovation_project_access(t.project_id, 'investorportal', 'write'))
                        and public.rls_user_ok(renovation_milestones.user_id, 'renovation_project', t.project_id)));

create policy renovation_milestones_update on public.renovation_milestones
  for update to authenticated
  using (exists (select 1 from public.renovation_project_trades t
                 where t.id = renovation_milestones.project_trade_id
                   and (public.has_renovation_project_access(t.project_id, 'immobilien', 'write')
                        or public.has_renovation_project_access(t.project_id, 'investorportal', 'write'))))
  with check (exists (select 1 from public.renovation_project_trades t
                      where t.id = renovation_milestones.project_trade_id
                        and (public.has_renovation_project_access(t.project_id, 'immobilien', 'write')
                             or public.has_renovation_project_access(t.project_id, 'investorportal', 'write'))));

create policy renovation_milestones_delete on public.renovation_milestones
  for delete to authenticated
  using (exists (select 1 from public.renovation_project_trades t
                 where t.id = renovation_milestones.project_trade_id
                   and (public.has_renovation_project_access(t.project_id, 'immobilien', 'write')
                        or public.has_renovation_project_access(t.project_id, 'investorportal', 'write'))));


-- ---------------------------------------------------------------- renovation_tasks
alter table public.renovation_tasks enable row level security;

drop policy if exists "Users manage own renovation_tasks" on public.renovation_tasks;
drop policy if exists "shared_users_access" on public.renovation_tasks;
drop policy if exists renovation_tasks_select on public.renovation_tasks;
drop policy if exists renovation_tasks_insert on public.renovation_tasks;
drop policy if exists renovation_tasks_update on public.renovation_tasks;
drop policy if exists renovation_tasks_delete on public.renovation_tasks;

create policy renovation_tasks_select on public.renovation_tasks
  for select to authenticated
  using (
    public.has_renovation_project_access(project_id, 'immobilien', 'read')
    or public.has_renovation_project_access(project_id, 'investorportal', 'read')
  );

create policy renovation_tasks_insert on public.renovation_tasks
  for insert to authenticated
  with check (
    (public.has_renovation_project_access(project_id, 'immobilien', 'write')
     or public.has_renovation_project_access(project_id, 'investorportal', 'write'))
    and (property_id is null
         or public.has_property_access(property_id, 'immobilien', 'write')
         or public.has_property_access(property_id, 'investorportal', 'write'))
    and (project_trade_id is null
         or exists (select 1 from public.renovation_project_trades t
                    where t.id = renovation_tasks.project_trade_id
                      and t.project_id = renovation_tasks.project_id))
    and public.rls_user_ok(user_id, 'renovation_project', project_id)
  );

create policy renovation_tasks_update on public.renovation_tasks
  for update to authenticated
  using (
    public.has_renovation_project_access(project_id, 'immobilien', 'write')
    or public.has_renovation_project_access(project_id, 'investorportal', 'write')
  )
  with check (
    (public.has_renovation_project_access(project_id, 'immobilien', 'write')
     or public.has_renovation_project_access(project_id, 'investorportal', 'write'))
    and (property_id is null
         or public.has_property_access(property_id, 'immobilien', 'write')
         or public.has_property_access(property_id, 'investorportal', 'write'))
    and (project_trade_id is null
         or exists (select 1 from public.renovation_project_trades t
                    where t.id = renovation_tasks.project_trade_id
                      and t.project_id = renovation_tasks.project_id))
  );

create policy renovation_tasks_delete on public.renovation_tasks
  for delete to authenticated
  using (
    public.has_renovation_project_access(project_id, 'immobilien', 'write')
    or public.has_renovation_project_access(project_id, 'investorportal', 'write')
  );


-- ---------------------------------------------------------------- renovation_calculations
-- Ohne Objekt: nur der Ersteller. Lesen auch für den Ersteller (wie Fundament).
alter table public.renovation_calculations enable row level security;

drop policy if exists "Users manage own renovation_calculations" on public.renovation_calculations;
drop policy if exists "shared_users_access" on public.renovation_calculations;
drop policy if exists renovation_calculations_select on public.renovation_calculations;
drop policy if exists renovation_calculations_insert on public.renovation_calculations;
drop policy if exists renovation_calculations_update on public.renovation_calculations;
drop policy if exists renovation_calculations_delete on public.renovation_calculations;

create policy renovation_calculations_select on public.renovation_calculations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_property_access(property_id, 'immobilien', 'read')
    or public.has_property_access(property_id, 'investorportal', 'read')
  );

create policy renovation_calculations_insert on public.renovation_calculations
  for insert to authenticated
  with check (
    case
      when property_id is null then user_id = (select auth.uid())
      else (public.has_property_access(property_id, 'immobilien', 'write')
            or public.has_property_access(property_id, 'investorportal', 'write'))
           and public.rls_user_ok(user_id, 'property', property_id)
    end
    and (unit_id is null
         or public.has_unit_access(unit_id, 'immobilien', 'write')
         or public.has_unit_access(unit_id, 'investorportal', 'write'))
  );

create policy renovation_calculations_update on public.renovation_calculations
  for update to authenticated
  using (
    case
      when property_id is null then user_id = (select auth.uid())
      else public.has_property_access(property_id, 'immobilien', 'write')
           or public.has_property_access(property_id, 'investorportal', 'write')
    end
  )
  with check (
    case
      when property_id is null then user_id = (select auth.uid())
      else public.has_property_access(property_id, 'immobilien', 'write')
           or public.has_property_access(property_id, 'investorportal', 'write')
    end
    and (unit_id is null
         or public.has_unit_access(unit_id, 'immobilien', 'write')
         or public.has_unit_access(unit_id, 'investorportal', 'write'))
  );

create policy renovation_calculations_delete on public.renovation_calculations
  for delete to authenticated
  using (
    case
      when property_id is null then user_id = (select auth.uid())
      else public.has_property_access(property_id, 'immobilien', 'write')
           or public.has_property_access(property_id, 'investorportal', 'write')
    end
  );


-- ---------------------------------------------------------------- renovation_calc_trades
alter table public.renovation_calc_trades enable row level security;

drop policy if exists "Users manage own renovation_calc_trades" on public.renovation_calc_trades;
drop policy if exists "shared_users_delete" on public.renovation_calc_trades;
drop policy if exists "shared_users_insert" on public.renovation_calc_trades;
drop policy if exists "shared_users_select" on public.renovation_calc_trades;
drop policy if exists "shared_users_update" on public.renovation_calc_trades;
drop policy if exists renovation_calc_trades_select on public.renovation_calc_trades;
drop policy if exists renovation_calc_trades_insert on public.renovation_calc_trades;
drop policy if exists renovation_calc_trades_update on public.renovation_calc_trades;
drop policy if exists renovation_calc_trades_delete on public.renovation_calc_trades;

create policy renovation_calc_trades_select on public.renovation_calc_trades
  for select to authenticated
  using (
    public.has_renovation_calculation_access(calculation_id, 'immobilien', 'read')
    or public.has_renovation_calculation_access(calculation_id, 'investorportal', 'read')
  );

create policy renovation_calc_trades_insert on public.renovation_calc_trades
  for insert to authenticated
  with check (
    (public.has_renovation_calculation_access(calculation_id, 'immobilien', 'write')
     or public.has_renovation_calculation_access(calculation_id, 'investorportal', 'write'))
    and public.rls_user_ok(user_id, 'renovation_calculation', calculation_id)
  );

create policy renovation_calc_trades_update on public.renovation_calc_trades
  for update to authenticated
  using (
    public.has_renovation_calculation_access(calculation_id, 'immobilien', 'write')
    or public.has_renovation_calculation_access(calculation_id, 'investorportal', 'write')
  )
  with check (
    public.has_renovation_calculation_access(calculation_id, 'immobilien', 'write')
    or public.has_renovation_calculation_access(calculation_id, 'investorportal', 'write')
  );

create policy renovation_calc_trades_delete on public.renovation_calc_trades
  for delete to authenticated
  using (
    public.has_renovation_calculation_access(calculation_id, 'immobilien', 'write')
    or public.has_renovation_calculation_access(calculation_id, 'investorportal', 'write')
  );


-- ---------------------------------------------------------------- renovation_calc_subtrades
alter table public.renovation_calc_subtrades enable row level security;

drop policy if exists "Users manage own renovation_calc_subtrades" on public.renovation_calc_subtrades;
drop policy if exists "shared_users_delete" on public.renovation_calc_subtrades;
drop policy if exists "shared_users_insert" on public.renovation_calc_subtrades;
drop policy if exists "shared_users_select" on public.renovation_calc_subtrades;
drop policy if exists "shared_users_update" on public.renovation_calc_subtrades;
drop policy if exists renovation_calc_subtrades_select on public.renovation_calc_subtrades;
drop policy if exists renovation_calc_subtrades_insert on public.renovation_calc_subtrades;
drop policy if exists renovation_calc_subtrades_update on public.renovation_calc_subtrades;
drop policy if exists renovation_calc_subtrades_delete on public.renovation_calc_subtrades;

create policy renovation_calc_subtrades_select on public.renovation_calc_subtrades
  for select to authenticated
  using (exists (select 1 from public.renovation_calc_trades t
                 where t.id = renovation_calc_subtrades.calc_trade_id
                   and (public.has_renovation_calculation_access(t.calculation_id, 'immobilien', 'read')
                        or public.has_renovation_calculation_access(t.calculation_id, 'investorportal', 'read'))));

create policy renovation_calc_subtrades_insert on public.renovation_calc_subtrades
  for insert to authenticated
  with check (exists (select 1 from public.renovation_calc_trades t
                      where t.id = renovation_calc_subtrades.calc_trade_id
                        and (public.has_renovation_calculation_access(t.calculation_id, 'immobilien', 'write')
                             or public.has_renovation_calculation_access(t.calculation_id, 'investorportal', 'write'))
                        and public.rls_user_ok(renovation_calc_subtrades.user_id, 'renovation_calculation', t.calculation_id)));

create policy renovation_calc_subtrades_update on public.renovation_calc_subtrades
  for update to authenticated
  using (exists (select 1 from public.renovation_calc_trades t
                 where t.id = renovation_calc_subtrades.calc_trade_id
                   and (public.has_renovation_calculation_access(t.calculation_id, 'immobilien', 'write')
                        or public.has_renovation_calculation_access(t.calculation_id, 'investorportal', 'write'))))
  with check (exists (select 1 from public.renovation_calc_trades t
                      where t.id = renovation_calc_subtrades.calc_trade_id
                        and (public.has_renovation_calculation_access(t.calculation_id, 'immobilien', 'write')
                             or public.has_renovation_calculation_access(t.calculation_id, 'investorportal', 'write'))));

create policy renovation_calc_subtrades_delete on public.renovation_calc_subtrades
  for delete to authenticated
  using (exists (select 1 from public.renovation_calc_trades t
                 where t.id = renovation_calc_subtrades.calc_trade_id
                   and (public.has_renovation_calculation_access(t.calculation_id, 'immobilien', 'write')
                        or public.has_renovation_calculation_access(t.calculation_id, 'investorportal', 'write'))));


-- ---------------------------------------------------------------- Sanierungs-Bibliothek
-- renovation_trades, renovation_subtrades, renovation_positions,
-- renovation_milestone_templates: nutzerbezogen (kein Portfolio). Lesen und Anlegen
-- (unter der user_id des Eigentümers) mit Freigabe "immobilien"/"investorportal";
-- Ändern/Löschen nur der Eigentümer. Unterpositionen nur unter eigenen Elternzeilen.

alter table public.renovation_trades enable row level security;

drop policy if exists "Users manage own renovation_trades" on public.renovation_trades;
drop policy if exists "shared_users_insert" on public.renovation_trades;
drop policy if exists "shared_users_select" on public.renovation_trades;
drop policy if exists renovation_trades_select on public.renovation_trades;
drop policy if exists renovation_trades_insert on public.renovation_trades;
drop policy if exists renovation_trades_update on public.renovation_trades;
drop policy if exists renovation_trades_delete on public.renovation_trades;

create policy renovation_trades_select on public.renovation_trades
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.rls_owner_shares(user_id, 'immobilien', 'read')
    or public.rls_owner_shares(user_id, 'investorportal', 'read')
  );

create policy renovation_trades_insert on public.renovation_trades
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or public.rls_owner_shares(user_id, 'immobilien', 'write')
    or public.rls_owner_shares(user_id, 'investorportal', 'write')
  );

create policy renovation_trades_update on public.renovation_trades
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy renovation_trades_delete on public.renovation_trades
  for delete to authenticated
  using (user_id = (select auth.uid()));


alter table public.renovation_subtrades enable row level security;

drop policy if exists "Users manage own renovation_subtrades" on public.renovation_subtrades;
drop policy if exists "shared_users_insert" on public.renovation_subtrades;
drop policy if exists "shared_users_select" on public.renovation_subtrades;
drop policy if exists renovation_subtrades_select on public.renovation_subtrades;
drop policy if exists renovation_subtrades_insert on public.renovation_subtrades;
drop policy if exists renovation_subtrades_update on public.renovation_subtrades;
drop policy if exists renovation_subtrades_delete on public.renovation_subtrades;

create policy renovation_subtrades_select on public.renovation_subtrades
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.rls_owner_shares(user_id, 'immobilien', 'read')
    or public.rls_owner_shares(user_id, 'investorportal', 'read')
  );

create policy renovation_subtrades_insert on public.renovation_subtrades
  for insert to authenticated
  with check (
    (user_id = (select auth.uid())
     or public.rls_owner_shares(user_id, 'immobilien', 'write')
     or public.rls_owner_shares(user_id, 'investorportal', 'write'))
    and exists (select 1 from public.renovation_trades t
                where t.id = renovation_subtrades.trade_id
                  and t.user_id = renovation_subtrades.user_id)
  );

create policy renovation_subtrades_update on public.renovation_subtrades
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.renovation_trades t
                where t.id = renovation_subtrades.trade_id
                  and t.user_id = renovation_subtrades.user_id)
  );

create policy renovation_subtrades_delete on public.renovation_subtrades
  for delete to authenticated
  using (user_id = (select auth.uid()));


alter table public.renovation_positions enable row level security;

drop policy if exists "Users manage own renovation_positions" on public.renovation_positions;
drop policy if exists "shared_users_insert" on public.renovation_positions;
drop policy if exists "shared_users_select" on public.renovation_positions;
drop policy if exists renovation_positions_select on public.renovation_positions;
drop policy if exists renovation_positions_insert on public.renovation_positions;
drop policy if exists renovation_positions_update on public.renovation_positions;
drop policy if exists renovation_positions_delete on public.renovation_positions;

create policy renovation_positions_select on public.renovation_positions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.rls_owner_shares(user_id, 'immobilien', 'read')
    or public.rls_owner_shares(user_id, 'investorportal', 'read')
  );

create policy renovation_positions_insert on public.renovation_positions
  for insert to authenticated
  with check (
    (user_id = (select auth.uid())
     or public.rls_owner_shares(user_id, 'immobilien', 'write')
     or public.rls_owner_shares(user_id, 'investorportal', 'write'))
    and exists (select 1 from public.renovation_subtrades s
                where s.id = renovation_positions.subtrade_id
                  and s.user_id = renovation_positions.user_id)
  );

create policy renovation_positions_update on public.renovation_positions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.renovation_subtrades s
                where s.id = renovation_positions.subtrade_id
                  and s.user_id = renovation_positions.user_id)
  );

create policy renovation_positions_delete on public.renovation_positions
  for delete to authenticated
  using (user_id = (select auth.uid()));


alter table public.renovation_milestone_templates enable row level security;

drop policy if exists "Users manage own renovation_milestone_templates" on public.renovation_milestone_templates;
drop policy if exists "shared_users_insert" on public.renovation_milestone_templates;
drop policy if exists "shared_users_select" on public.renovation_milestone_templates;
drop policy if exists renovation_milestone_templates_select on public.renovation_milestone_templates;
drop policy if exists renovation_milestone_templates_insert on public.renovation_milestone_templates;
drop policy if exists renovation_milestone_templates_update on public.renovation_milestone_templates;
drop policy if exists renovation_milestone_templates_delete on public.renovation_milestone_templates;

create policy renovation_milestone_templates_select on public.renovation_milestone_templates
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.rls_owner_shares(user_id, 'immobilien', 'read')
    or public.rls_owner_shares(user_id, 'investorportal', 'read')
  );

create policy renovation_milestone_templates_insert on public.renovation_milestone_templates
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or public.rls_owner_shares(user_id, 'immobilien', 'write')
    or public.rls_owner_shares(user_id, 'investorportal', 'write')
  );

create policy renovation_milestone_templates_update on public.renovation_milestone_templates
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy renovation_milestone_templates_delete on public.renovation_milestone_templates
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- =============================================================================
-- 11. Nur eigener Nutzer: bank_*, push_subscriptions, profiles, user_smtp_settings
-- =============================================================================

-- ---------------------------------------------------------------- bank_connections
alter table public.bank_connections enable row level security;

drop policy if exists "Users can delete their own bank connections" on public.bank_connections;
drop policy if exists "Users can insert their own bank connections" on public.bank_connections;
drop policy if exists "Users can view their own bank connections" on public.bank_connections;
drop policy if exists "Users can update their own bank connections" on public.bank_connections;
drop policy if exists bank_connections_select on public.bank_connections;
drop policy if exists bank_connections_insert on public.bank_connections;
drop policy if exists bank_connections_update on public.bank_connections;
drop policy if exists bank_connections_delete on public.bank_connections;

create policy bank_connections_select on public.bank_connections
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy bank_connections_insert on public.bank_connections
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy bank_connections_update on public.bank_connections
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy bank_connections_delete on public.bank_connections
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- ---------------------------------------------------------------- bank_matching_rules
alter table public.bank_matching_rules enable row level security;

drop policy if exists "Users can delete their own matching rules" on public.bank_matching_rules;
drop policy if exists "Users can insert their own matching rules" on public.bank_matching_rules;
drop policy if exists "Users can view their own matching rules" on public.bank_matching_rules;
drop policy if exists "Users can update their own matching rules" on public.bank_matching_rules;
drop policy if exists bank_matching_rules_select on public.bank_matching_rules;
drop policy if exists bank_matching_rules_insert on public.bank_matching_rules;
drop policy if exists bank_matching_rules_update on public.bank_matching_rules;
drop policy if exists bank_matching_rules_delete on public.bank_matching_rules;

create policy bank_matching_rules_select on public.bank_matching_rules
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy bank_matching_rules_insert on public.bank_matching_rules
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (property_id is null or public.has_property_access(property_id, 'finanzen', 'write'))
    and (unit_id is null or public.has_unit_access(unit_id, 'finanzen', 'write'))
  );

create policy bank_matching_rules_update on public.bank_matching_rules
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (property_id is null or public.has_property_access(property_id, 'finanzen', 'write'))
    and (unit_id is null or public.has_unit_access(unit_id, 'finanzen', 'write'))
  );

create policy bank_matching_rules_delete on public.bank_matching_rules
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- ---------------------------------------------------------------- bank_transactions
alter table public.bank_transactions enable row level security;

drop policy if exists "Users can delete their own bank transactions" on public.bank_transactions;
drop policy if exists "Users can insert their own bank transactions" on public.bank_transactions;
drop policy if exists "Users can view their own bank transactions" on public.bank_transactions;
drop policy if exists "Users can update their own bank transactions" on public.bank_transactions;
drop policy if exists bank_transactions_select on public.bank_transactions;
drop policy if exists bank_transactions_insert on public.bank_transactions;
drop policy if exists bank_transactions_update on public.bank_transactions;
drop policy if exists bank_transactions_delete on public.bank_transactions;

create policy bank_transactions_select on public.bank_transactions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy bank_transactions_insert on public.bank_transactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.bank_connections c
                where c.id = bank_transactions.connection_id
                  and c.user_id = (select auth.uid()))
  );

create policy bank_transactions_update on public.bank_transactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.bank_connections c
                where c.id = bank_transactions.connection_id
                  and c.user_id = (select auth.uid()))
  );

create policy bank_transactions_delete on public.bank_transactions
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- ---------------------------------------------------------------- push_subscriptions
-- "Service role full access" entfällt (service_role umgeht RLS ohnehin).
alter table public.push_subscriptions enable row level security;

drop policy if exists "Service role full access" on public.push_subscriptions;
drop policy if exists "Users can delete own subscriptions" on public.push_subscriptions;
drop policy if exists "Users can insert own subscriptions" on public.push_subscriptions;
drop policy if exists "Users can view own subscriptions" on public.push_subscriptions;
drop policy if exists "Users can update own subscriptions" on public.push_subscriptions;
drop policy if exists push_subscriptions_select on public.push_subscriptions;
drop policy if exists push_subscriptions_insert on public.push_subscriptions;
drop policy if exists push_subscriptions_update on public.push_subscriptions;
drop policy if exists push_subscriptions_delete on public.push_subscriptions;

create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_update on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- ---------------------------------------------------------------- profiles
-- Doppelte Policies zusammengeführt. Die Mieter-Sicht auf das Vermieter-Profil
-- (Öffnungszeiten in der Topbar) bleibt, gilt aber nur noch für echte
-- Mieterrollen; Spaltenbeschränkung braucht eine RPC/View (siehe Bericht).
alter table public.profiles enable row level security;

drop policy if exists "Users can insert their own profile." on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "Tenants can view owner profile settings" on public.profiles;
drop policy if exists "Users can view their own profile." on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "Users can update own profile." on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "Tenants can view owner profile settings" on public.profiles
  for select to authenticated
  using (public.rls_is_my_landlord(id));

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));


-- ---------------------------------------------------------------- user_smtp_settings
-- Policy war bereits korrekt; nur aufgeteilt und mit (select auth.uid()).
-- Passwort-Schutz (D3b-17) braucht App- und Edge-Function-Änderungen (Bericht).
alter table public.user_smtp_settings enable row level security;

drop policy if exists "Users can manage their own SMTP settings" on public.user_smtp_settings;
drop policy if exists user_smtp_settings_select on public.user_smtp_settings;
drop policy if exists user_smtp_settings_insert on public.user_smtp_settings;
drop policy if exists user_smtp_settings_update on public.user_smtp_settings;
drop policy if exists user_smtp_settings_delete on public.user_smtp_settings;

create policy user_smtp_settings_select on public.user_smtp_settings
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_smtp_settings_insert on public.user_smtp_settings
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy user_smtp_settings_update on public.user_smtp_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_smtp_settings_delete on public.user_smtp_settings
  for delete to authenticated
  using (user_id = (select auth.uid()));
