-- =============================================================================
-- SEC-POLICIES (Komplett-Check 2026-11-27): alle übrigen RLS-Policies im Schema public
--
-- Ziel: Freigabe-Rechte (portfolio_shares.permissions) werden je Kategorie durchgesetzt
-- (Lesen <> Schreiben), Eigentümer-Zugriff hängt am Portfolio statt an der user_id
-- der Zeile, referenzierte Objekte/Einheiten/Mieter/Portfolios/Verträge müssen beim
-- Schreiben dem Nutzer gehören bzw. für ihn schreibbar sein. Eine Policy je Kommando,
-- alle "to authenticated", "with check" bei INSERT/UPDATE, auth.uid() als
-- (select auth.uid()).
--
-- Befunde (eigenes Paket):
--   D3a-03  Freigabe-Rechte nicht erzwungen (für alle Tabellen dieses Pakets)
--   D3a-05  document_templates in fremde Portfolios einschleusbar
--   D3a-06  documents / objektkalender_* mit fremder property_id/tenant_id
--   D3a-07  pdf_templates mit fremder portfolio_id
--   D3a-09  messages: Empfänger konnte Inhalt ändern (Spaltenrecht nur "read")
--   D3a-10  claim_events: Ändern/Löschen nur noch mit Schreibrecht "finanzen" (teilweise,
--           volle Unveränderlichkeit braucht App-Änderung + Trigger, siehe Bericht)
--   D3a-17  doppelte/überlappende Policies zusammengeführt
--   G23-01  tickets: Löschregel eng (nur Schreibrecht "mieterportal" auf das Objekt)
--   4.9     leases.tenant_id / contacts.tenant_id nur Mieter desselben Eigentümers
--   R1-05   (Policy-Teil) Buchungen von Mitnutzern sind für den Eigentümer sichtbar
--   R1-12   (teilweise) Policies versioniert, has_contact_access wird nicht mehr benutzt
--   R1-16   (Policy-Teil) claims-Zugriff über lease_id statt has_claim_columns_access
-- Mitbehoben (Befunde anderer Pakete, Tabellen gehören laut RULES 4 hierher):
--   D3a-08/M1-06 messages-INSERT nur in Vermieter-Mieter-Beziehung, is_system nur Verwalter
--   D3b-06/M1-08/D3b-15 tickets: Mieter nur eigene Einheit, kein Ändern/Löschen durch Mieter
--   D3a-14/D3a-15/M1-13 objektkalender: Mieter nur Status ihrer Termine, Verlauf nur eigene
--   D3a-11/D3a-12/R1-04/D2-15 is_user_shared_with_me nicht mehr in Policies, Eigentümer
--           sieht Zeilen von Mitnutzern
--   D3a-13  claims/leases/invoice_counters: Elternprüfung beim Schreiben
--   D3b-12  rent_payments: Buchungen von Mitnutzern für Eigentümer sichtbar
--   M2-04   document_templates (= D3a-05)
--   M1-05/G02-06 (teilweise) Vermieter-Profil nur noch für echte Mieter-Rollen
--   D3b-20  doppelte Policies auf profiles/push_subscriptions entfernt
--
-- Kategorien (Fundament, RULES 3) und hier ergänzte Lese-/Menü-Abhängigkeiten:
--   leases, tenants ............ lesen '*' (Stammdaten, werden von allen Seiten
--                                 eingebettet), schreiben mietverhaeltnisse
--   rent_payments .............. lesen mietverhaeltnisse|finanzen, schreiben dito/write
--   invoices, invoice_items, invoice_counters, claims, claim_*, payment_plan* ... finanzen
--   expenses ................... lesen finanzen|nebenkosten (NK-Abrechnung), schreiben finanzen
--   loans ...................... finanzen|investorportal (Menü "Finanzierungen" im Investorportal)
--   utility_settlements ........ nebenkosten
--   distribution_keys, expense_categories ... lesen '*', anlegen nebenkosten/write, ändern nur Eigentümer
--   meters, meter_readings ..... zaehler
--   contacts ................... kontakte (+ Lesen, wenn mit lesbarer Rechnung/Gewerk verknüpft)
--   documents, objektkalender_*  immobilien|mieterportal (Menü liegt im Mieterportal)
--   floor_plans, renovation_* .. immobilien|investorportal (Menü "Sanierungsmanager")
--   announcements, tickets ..... mieterportal
--   deals ...................... investorportal
--   pdf_templates, document_templates ... lesen '*', schreiben nur Portfolio-Eigentümer
--   bank_*, push_subscriptions, profiles, user_smtp_settings ... nur eigener Nutzer
--
-- Nicht angefasst (andere Pakete): portfolio_shares, portfolios, properties, units,
-- economic_units (SEC-SHARES); user_roles, tenant_invitations, tenant_verification_links,
-- tenants-Policies mit Präfix "tenants_" (SEC-ROLES); rental_* (SEC-LETTING);
-- subscriptions (BILLING); cloud_connections, portfolio_cloud_links (CLOUD);
-- rent_ledger, rent_charges (RENT); storage.objects (SEC-STORAGE).
-- Unverändert übernommen (reine, enge Mieter-Lese-Policies über user_roles):
--   tenants_read_announcements, tenants_read_general_docs, tenants_read_personal_docs,
--   tenants_read_own_leases, ok_tenants_read_events, ok_tenants_read_history,
--   ok_tenants_read_settings.
--
-- Voraussetzung: 20261127100000_sec_access_helpers.sql (has_*_access mit Kategorie).
-- Idempotent: mehrfaches Ausführen ist unschädlich.
--
-- Kompatibilität mit der heutigen App:
--   * Die App schreibt user_id = eigener Nutzer (bei Forderungs-Ereignissen
--     user_id = Forderungs-Eigentümer). Beides bleibt erlaubt; zusätzlich ist
--     user_id = Portfolio-Eigentümer erlaubt (für künftige Trigger, die den
--     Eigentümer eintragen).
--   * Mitnutzer, die heute Portfolio-Vorlagen (document_templates/pdf_templates)
--     speichern, können das nicht mehr (Vorgabe RULES 3: schreiben nur Eigentümer).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Hilfsfunktionen (nur für die Policies dieses Pakets; SECURITY DEFINER, damit
--    Querverweise auf andere Tabellen keine RLS-Rekursion auslösen und nicht von
--    deren Policies abhängen). Alle liefern für nicht angemeldete Aufrufer false.
-- -----------------------------------------------------------------------------

-- Hat der Eigentümer p_owner dem Aufrufer irgendein Portfolio mit diesem Recht
-- freigegeben (oder ist der Aufrufer selbst p_owner)? Für Tabellen ohne
-- Portfolio-Bezug (Kontakte, Bibliotheken). Ersetzt is_user_shared_with_me.
create or replace function public.rls_owner_shares(p_owner uuid, p_category text, p_access text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    auth.uid() is not null
    and p_owner is not null
    and (
      p_owner = auth.uid()
      or exists (select 1 from public.portfolios po
                 where po.user_id = p_owner
                   and public.has_portfolio_access(po.id, p_category, p_access))
    ), false)
$$;

-- Ist der Aufrufer Eigentümer dieses Portfolios?
create or replace function public.rls_is_portfolio_owner(p_portfolio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    auth.uid() is not null
    and exists (select 1 from public.portfolios po
                where po.id = p_portfolio_id and po.user_id = auth.uid()),
    false)
$$;

-- Zulässige user_id beim Anlegen: der Aufrufer selbst oder der Eigentümer des
-- übergeordneten Portfolios (bei Forderungen auch der Forderungs-Eigentümer, bei
-- Sanierungsprojekten/-kalkulationen auch deren Ersteller).
-- p_kind: portfolio | property | unit | lease | claim | invoice | economic_unit |
--         renovation_project | renovation_calculation
create or replace function public.rls_user_ok(p_user_id uuid, p_kind text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    auth.uid() is not null
    and p_user_id is not null
    and (
      p_user_id = auth.uid()
      or p_user_id = case p_kind
        when 'portfolio' then
          (select po.user_id from public.portfolios po where po.id = p_id)
        when 'property' then
          (select po.user_id from public.properties pr
             join public.portfolios po on po.id = pr.portfolio_id
            where pr.id = p_id)
        when 'unit' then
          (select po.user_id from public.units u
             join public.properties pr on pr.id = u.property_id
             join public.portfolios po on po.id = pr.portfolio_id
            where u.id = p_id)
        when 'lease' then
          (select po.user_id from public.leases l
             join public.units u on u.id = l.unit_id
             join public.properties pr on pr.id = u.property_id
             join public.portfolios po on po.id = pr.portfolio_id
            where l.id = p_id)
        when 'claim' then
          (select po.user_id from public.claims c
             join public.leases l on l.id = c.lease_id
             join public.units u on u.id = l.unit_id
             join public.properties pr on pr.id = u.property_id
             join public.portfolios po on po.id = pr.portfolio_id
            where c.id = p_id)
        when 'invoice' then
          (select po.user_id from public.invoices i
             join public.portfolios po on po.id = i.portfolio_id
            where i.id = p_id)
        when 'economic_unit' then
          (select e.user_id from public.economic_units e where e.id = p_id)
        when 'renovation_project' then
          (select po.user_id from public.renovation_projects rp
             join public.properties pr on pr.id = rp.property_id
             join public.portfolios po on po.id = pr.portfolio_id
            where rp.id = p_id)
        when 'renovation_calculation' then
          (select po.user_id from public.renovation_calculations rc
             join public.properties pr on pr.id = rc.property_id
             join public.portfolios po on po.id = pr.portfolio_id
            where rc.id = p_id)
        else null
      end
      or (p_kind = 'claim'
          and p_user_id = (select c.user_id from public.claims c where c.id = p_id))
      or (p_kind = 'renovation_project'
          and p_user_id = (select rp.user_id from public.renovation_projects rp where rp.id = p_id))
      or (p_kind = 'renovation_calculation'
          and p_user_id = (select rc.user_id from public.renovation_calculations rc where rc.id = p_id))
    ), false)
$$;

-- Darf dieser Mieter verknüpft werden? (Befund 4.9)
--   p_kind = 'user'  : tenants.user_id = p_id (Kontakte: Mieter desselben Kontakt-Eigentümers)
--   sonst            : tenants.user_id = Aufrufer oder Eigentümer des Portfolios von (p_kind, p_id),
--                      oder der Mieter hat bereits einen Vertrag in genau diesem Objekt /
--                      dieser Einheit / ist Mieter dieses Vertrags (z. B. von einem Mitnutzer
--                      angelegte Mieter). Neue Verträge entstehen nur über leases_insert,
--                      fremde Mieter lassen sich so nicht einschleusen.
create or replace function public.rls_tenant_ok(p_tenant_id uuid, p_kind text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_tenant_id is null
      or exists (select 1 from public.tenants t
                 where t.id = p_tenant_id
                   and case when p_kind = 'user' then t.user_id = p_id
                            else public.rls_user_ok(t.user_id, p_kind, p_id) end)
      or (p_kind = 'property'
          and exists (select 1 from public.leases l
                      join public.units u on u.id = l.unit_id
                      where l.tenant_id = p_tenant_id and u.property_id = p_id))
      or (p_kind = 'unit'
          and exists (select 1 from public.leases l
                      where l.tenant_id = p_tenant_id and l.unit_id = p_id))
      or (p_kind = 'lease'
          and exists (select 1 from public.leases l
                      where l.id = p_id and l.tenant_id = p_tenant_id))
$$;

-- Bestehende Mieter-Verknüpfung einer Zeile bleibt unverändert? (UPDATE von
-- Altdaten, deren Mieter einem anderen Nutzer gehört, soll weiter möglich sein,
-- solange tenant_id nicht geändert wird.)
create or replace function public.rls_tenant_link_unchanged(p_table text, p_id uuid, p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    auth.uid() is not null
    and case p_table
      when 'leases' then exists (select 1 from public.leases x
                                 where x.id = p_id and x.tenant_id is not distinct from p_tenant_id)
      when 'claims' then exists (select 1 from public.claims x
                                 where x.id = p_id and x.tenant_id is not distinct from p_tenant_id)
      when 'contacts' then exists (select 1 from public.contacts x
                                   where x.id = p_id and x.tenant_id is not distinct from p_tenant_id)
      when 'documents' then exists (select 1 from public.documents x
                                    where x.id = p_id and x.tenant_id is not distinct from p_tenant_id)
      else false
    end, false)
$$;

-- Mieter ohne jeden Mietvertrag, dessen Eigentümer dem Aufrufer mit diesem Recht
-- freigegeben hat (neu angelegte Mieter vor dem ersten Vertrag).
create or replace function public.rls_tenant_unleased_shared(p_tenant_id uuid, p_owner uuid, p_category text, p_access text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    p_tenant_id is not null
    and not exists (select 1 from public.leases l where l.tenant_id = p_tenant_id)
    and public.rls_owner_shares(p_owner, p_category, p_access),
    false)
$$;

-- Gespeicherte user_id eines Mieters entspricht p_user_id (Schutz gegen Übernahme).
create or replace function public.rls_tenant_user_id_unchanged(p_tenant_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (select 1 from public.tenants t
                     where t.id = p_tenant_id
                       and t.user_id is distinct from p_user_id)
$$;

-- Hat p_user_id eine Mieterrolle für diese Einheit?
create or replace function public.rls_is_unit_tenant(p_user_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    auth.uid() is not null
    and p_user_id is not null
    and p_unit_id is not null
    and exists (select 1 from public.user_roles ur
                where ur.user_id = p_user_id
                  and ur.role = 'tenant'
                  and ur.unit_id = p_unit_id),
    false)
$$;

-- Ist p_user_id der Vermieter (Portfolio-Eigentümer) eines Objekts, für das der
-- Aufrufer eine Mieterrolle hat?
create or replace function public.rls_is_my_landlord(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    auth.uid() is not null
    and p_user_id is not null
    and exists (select 1 from public.user_roles ur
                join public.properties pr on pr.id = ur.property_id
                join public.portfolios po on po.id = pr.portfolio_id
                where ur.user_id = auth.uid()
                  and ur.role = 'tenant'
                  and po.user_id = p_user_id),
    false)
$$;

-- Objektkalender: hat ein Mieter-UPDATE nur Status/Erledigt-Felder geändert?
-- (Vergleich mit der gespeicherten Zeile; Befunde D3a-15, M1-13, G11-01 DB-Teil)
create or replace function public.rls_ok_event_core_unchanged(
    p_id uuid,
    p_user_id uuid,
    p_property_id uuid,
    p_event_type text,
    p_title text,
    p_color text,
    p_event_date date,
    p_recurring boolean,
    p_recurrence_rule text,
    p_recurring_end_date date,
    p_assigned_unit_id uuid,
    p_assigned_unit_name text,
    p_waste_type text,
    p_push_enabled boolean)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.objektkalender_events e
    where e.id = p_id
      and e.user_id is not distinct from p_user_id
      and e.property_id is not distinct from p_property_id
      and e.event_type is not distinct from p_event_type
      and e.title is not distinct from p_title
      and e.color is not distinct from p_color
      and e.event_date is not distinct from p_event_date
      and e.recurring is not distinct from p_recurring
      and e.recurrence_rule is not distinct from p_recurrence_rule
      and e.recurring_end_date is not distinct from p_recurring_end_date
      and e.assigned_unit_id is not distinct from p_assigned_unit_id
      and e.assigned_unit_name is not distinct from p_assigned_unit_name
      and e.waste_type is not distinct from p_waste_type
      and e.push_enabled is not distinct from p_push_enabled)
$$;

-- Nachrichten nur innerhalb einer Vermieter-/Verwalter-Mieter-Beziehung
-- (Befunde D3a-08, M1-06):
--   (1) Absender hat Schreibrecht "mieterportal" auf ein Objekt, für das der
--       Empfänger eine Mieterrolle hat (Systemnachrichten nur in diesem Fall),
--   (2) Absender ist Mieter, Empfänger ist Eigentümer oder Mitnutzer (mieterportal)
--       des Portfolios seines Objekts,
--   (3) Antwort an jemanden, der dem Absender bereits geschrieben hat.
-- Ein angegebenes Ticket muss dem Absender gehören bzw. für ihn beschreibbar sein.
create or replace function public.rls_message_allowed(p_receiver uuid, p_ticket_id uuid, p_is_system boolean)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    auth.uid() is not null
    and p_receiver is not null
    and p_receiver <> auth.uid()
    and (
      exists (select 1 from public.user_roles ur
              where ur.user_id = p_receiver
                and ur.role = 'tenant'
                and ur.property_id is not null
                and public.has_property_access(ur.property_id, 'mieterportal', 'write'))
      or (
        coalesce(p_is_system, false) = false
        and (
          exists (select 1 from public.user_roles me
                  join public.properties pr on pr.id = me.property_id
                  join public.portfolios po on po.id = pr.portfolio_id
                  where me.user_id = auth.uid()
                    and me.role = 'tenant'
                    and (po.user_id = p_receiver
                         or exists (select 1 from public.portfolio_shares s
                                    join auth.users au on lower(au.email) = lower(s.shared_with_email)
                                    where s.portfolio_id = po.id
                                      and s.status = 'accepted'
                                      and au.id = p_receiver
                                      and public.share_permits(s.permissions, 'mieterportal', 'read'))))
          or exists (select 1 from public.messages m
                     where m.sender_id = p_receiver and m.receiver_id = auth.uid())
        )
      )
    )
    and (
      p_ticket_id is null
      or exists (select 1 from public.tickets t
                 where t.id = p_ticket_id
                   and (t.tenant_user_id = auth.uid()
                        or public.has_property_access(t.property_id, 'mieterportal', 'write')))
    ), false)
$$;


-- =============================================================================
-- 1. Mieterportal: announcements, tickets, messages
-- =============================================================================

-- ---------------------------------------------------------------- announcements
alter table public.announcements enable row level security;

drop policy if exists "investors_manage_own_announcements" on public.announcements;
drop policy if exists "shared_users_access" on public.announcements;
drop policy if exists announcements_select on public.announcements;
drop policy if exists announcements_insert on public.announcements;
drop policy if exists announcements_update on public.announcements;
drop policy if exists announcements_delete on public.announcements;
-- bleibt: tenants_read_announcements

create policy announcements_select on public.announcements
  for select to authenticated
  using (public.has_property_access(property_id, 'mieterportal', 'read'));

create policy announcements_insert on public.announcements
  for insert to authenticated
  with check (
    public.has_property_access(property_id, 'mieterportal', 'write')
    and (created_by is null or created_by = (select auth.uid()))
  );

create policy announcements_update on public.announcements
  for update to authenticated
  using (public.has_property_access(property_id, 'mieterportal', 'write'))
  with check (public.has_property_access(property_id, 'mieterportal', 'write'));

create policy announcements_delete on public.announcements
  for delete to authenticated
  using (public.has_property_access(property_id, 'mieterportal', 'write'));


-- ---------------------------------------------------------------- tickets
alter table public.tickets enable row level security;

drop policy if exists "investors_manage_own_tickets" on public.tickets;
drop policy if exists "shared_users_access" on public.tickets;
drop policy if exists "tenants_manage_own_tickets" on public.tickets;
drop policy if exists "investors_delete_tickets" on public.tickets;
drop policy if exists tickets_select on public.tickets;
drop policy if exists tickets_insert on public.tickets;
drop policy if exists tickets_update on public.tickets;
drop policy if exists tickets_delete on public.tickets;

create policy tickets_select on public.tickets
  for select to authenticated
  using (
    tenant_user_id = (select auth.uid())
    or public.has_property_access(property_id, 'mieterportal', 'read')
  );

-- Mieter: nur für die eigene Einheit laut Mieterrolle, Status beim Anlegen 'received'.
-- Verwalter: Objekt/Einheit beschreibbar, Ticket nur für einen Mieter dieser Einheit.
create policy tickets_insert on public.tickets
  for insert to authenticated
  with check (
    (
      tenant_user_id = (select auth.uid())
      and status = 'received'
      and exists (select 1 from public.user_roles ur
                  where ur.user_id = (select auth.uid())
                    and ur.role = 'tenant'
                    and ur.property_id = tickets.property_id
                    and ur.unit_id = tickets.unit_id)
    )
    or (
      public.has_property_access(property_id, 'mieterportal', 'write')
      and public.has_unit_access(unit_id, 'mieterportal', 'write')
      and public.rls_is_unit_tenant(tenant_user_id, unit_id)
    )
  );

-- Status/Priorität ändern und Löschen nur mit Schreibrecht "mieterportal" (G23-01)
create policy tickets_update on public.tickets
  for update to authenticated
  using (public.has_property_access(property_id, 'mieterportal', 'write'))
  with check (
    public.has_property_access(property_id, 'mieterportal', 'write')
    and public.has_unit_access(unit_id, 'mieterportal', 'write')
  );

create policy tickets_delete on public.tickets
  for delete to authenticated
  using (public.has_property_access(property_id, 'mieterportal', 'write'));


-- ---------------------------------------------------------------- messages
alter table public.messages enable row level security;

drop policy if exists "users_send_messages" on public.messages;
drop policy if exists "users_read_own_messages" on public.messages;
drop policy if exists "users_update_own_received" on public.messages;
drop policy if exists messages_select on public.messages;
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_update on public.messages;

create policy messages_select on public.messages
  for select to authenticated
  using (
    sender_id = (select auth.uid())
    or receiver_id = (select auth.uid())
  );

create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.rls_message_allowed(receiver_id, ticket_id, is_system)
  );

-- Empfänger darf nur die Lesebestätigung setzen (Spaltenrecht unten, D3a-09)
create policy messages_update on public.messages
  for update to authenticated
  using (receiver_id = (select auth.uid()))
  with check (receiver_id = (select auth.uid()));

revoke update on table public.messages from anon, authenticated;
grant update (read) on table public.messages to authenticated;


-- =============================================================================
-- 2. Mietverhältnisse: leases, tenants (ohne "tenants_"-Policies), rent_payments
-- =============================================================================

-- ---------------------------------------------------------------- leases
alter table public.leases enable row level security;

drop policy if exists "leases_own_all" on public.leases;
drop policy if exists "shared_users_access" on public.leases;
drop policy if exists leases_select on public.leases;
drop policy if exists leases_insert on public.leases;
drop policy if exists leases_update on public.leases;
drop policy if exists leases_delete on public.leases;
-- bleibt: tenants_read_own_leases

create policy leases_select on public.leases
  for select to authenticated
  using (public.has_unit_access(unit_id, '*', 'read'));

-- 4.9: tenant_id nur ein Mieter des Portfolio-Eigentümers (oder ein eigener Mieter
-- des anlegenden Mitnutzers, wie es die heutige App anlegt)
create policy leases_insert on public.leases
  for insert to authenticated
  with check (
    public.has_unit_access(unit_id, 'mietverhaeltnisse', 'write')
    and public.rls_user_ok(user_id, 'unit', unit_id)
    and public.rls_tenant_ok(tenant_id, 'unit', unit_id)
  );

create policy leases_update on public.leases
  for update to authenticated
  using (public.has_unit_access(unit_id, 'mietverhaeltnisse', 'write'))
  with check (
    public.has_unit_access(unit_id, 'mietverhaeltnisse', 'write')
    and (public.rls_tenant_ok(tenant_id, 'unit', unit_id)
         or public.rls_tenant_link_unchanged('leases', id, tenant_id))
  );

create policy leases_delete on public.leases
  for delete to authenticated
  using (public.has_unit_access(unit_id, 'mietverhaeltnisse', 'write'));


-- ---------------------------------------------------------------- tenants
-- Eigentümer-Policy tenants_owner_all und die Mieter-Selbstzugriffe
-- (tenants_read_own_tenant, tenants_update_own_tenant) gehören SEC-ROLES.
alter table public.tenants enable row level security;

drop policy if exists "shared_users_delete" on public.tenants;
drop policy if exists "shared_users_insert" on public.tenants;
drop policy if exists "shared_users_select" on public.tenants;
drop policy if exists "shared_users_update" on public.tenants;
drop policy if exists shared_tenant_select on public.tenants;
drop policy if exists shared_tenant_insert on public.tenants;
drop policy if exists shared_tenant_update on public.tenants;
drop policy if exists shared_tenant_delete on public.tenants;
drop policy if exists tenant_user_id_unchanged on public.tenants;

create policy shared_tenant_select on public.tenants
  for select to authenticated
  using (
    public.has_tenant_access(id, '*', 'read')
    or public.rls_tenant_unleased_shared(id, user_id, '*', 'read')
  );

-- Mitnutzer legt einen Mieter unter der user_id des Eigentümers an
create policy shared_tenant_insert on public.tenants
  for insert to authenticated
  with check (public.rls_owner_shares(user_id, 'mietverhaeltnisse', 'write'));

create policy shared_tenant_update on public.tenants
  for update to authenticated
  using (
    public.has_tenant_access(id, 'mietverhaeltnisse', 'write')
    or public.rls_tenant_unleased_shared(id, user_id, 'mietverhaeltnisse', 'write')
  )
  with check (
    public.has_tenant_access(id, 'mietverhaeltnisse', 'write')
    or public.rls_tenant_unleased_shared(id, user_id, 'mietverhaeltnisse', 'write')
  );

create policy shared_tenant_delete on public.tenants
  for delete to authenticated
  using (
    public.has_tenant_access(id, 'mietverhaeltnisse', 'write')
    or public.rls_tenant_unleased_shared(id, user_id, 'mietverhaeltnisse', 'write')
  );

-- RESTRICTIVE: die user_id eines Mieters kann per UPDATE niemand ändern
-- (sonst Übernahme fremder Mieter über tenants_owner_all als WITH CHECK).
create policy tenant_user_id_unchanged on public.tenants
  as restrictive
  for update to authenticated
  using (true)
  with check (public.rls_tenant_user_id_unchanged(id, user_id));


-- ---------------------------------------------------------------- rent_payments
alter table public.rent_payments enable row level security;

drop policy if exists "rent_payments_own_all" on public.rent_payments;
drop policy if exists "shared_users_delete" on public.rent_payments;
drop policy if exists "shared_users_insert" on public.rent_payments;
drop policy if exists "shared_users_select" on public.rent_payments;
drop policy if exists "shared_users_update" on public.rent_payments;
drop policy if exists rent_payments_select on public.rent_payments;
drop policy if exists rent_payments_insert on public.rent_payments;
drop policy if exists rent_payments_update on public.rent_payments;
drop policy if exists rent_payments_delete on public.rent_payments;

create policy rent_payments_select on public.rent_payments
  for select to authenticated
  using (
    public.has_lease_access(lease_id, 'finanzen', 'read')
    or public.has_lease_access(lease_id, 'mietverhaeltnisse', 'read')
  );

create policy rent_payments_insert on public.rent_payments
  for insert to authenticated
  with check (
    (public.has_lease_access(lease_id, 'finanzen', 'write')
     or public.has_lease_access(lease_id, 'mietverhaeltnisse', 'write'))
    and public.rls_user_ok(user_id, 'lease', lease_id)
  );

create policy rent_payments_update on public.rent_payments
  for update to authenticated
  using (
    public.has_lease_access(lease_id, 'finanzen', 'write')
    or public.has_lease_access(lease_id, 'mietverhaeltnisse', 'write')
  )
  with check (
    public.has_lease_access(lease_id, 'finanzen', 'write')
    or public.has_lease_access(lease_id, 'mietverhaeltnisse', 'write')
  );

create policy rent_payments_delete on public.rent_payments
  for delete to authenticated
  using (
    public.has_lease_access(lease_id, 'finanzen', 'write')
    or public.has_lease_access(lease_id, 'mietverhaeltnisse', 'write')
  );


-- =============================================================================
-- 3. Finanzen: invoices, invoice_items, invoice_counters, expenses, loans, deals
-- =============================================================================

-- ---------------------------------------------------------------- invoices
alter table public.invoices enable row level security;

drop policy if exists "invoices_own_all" on public.invoices;
drop policy if exists "shared_users_access" on public.invoices;
drop policy if exists invoices_select on public.invoices;
drop policy if exists invoices_insert on public.invoices;
drop policy if exists invoices_update on public.invoices;
drop policy if exists invoices_delete on public.invoices;

create policy invoices_select on public.invoices
  for select to authenticated
  using (public.has_portfolio_access(portfolio_id, 'finanzen', 'read'));

create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (
    public.has_portfolio_access(portfolio_id, 'finanzen', 'write')
    and (property_id is null or public.has_property_access(property_id, 'finanzen', 'write'))
    and (unit_id is null or public.has_unit_access(unit_id, 'finanzen', 'write'))
    and public.rls_user_ok(user_id, 'portfolio', portfolio_id)
  );

create policy invoices_update on public.invoices
  for update to authenticated
  using (public.has_portfolio_access(portfolio_id, 'finanzen', 'write'))
  with check (
    public.has_portfolio_access(portfolio_id, 'finanzen', 'write')
    and (property_id is null or public.has_property_access(property_id, 'finanzen', 'write'))
    and (unit_id is null or public.has_unit_access(unit_id, 'finanzen', 'write'))
  );

create policy invoices_delete on public.invoices
  for delete to authenticated
  using (public.has_portfolio_access(portfolio_id, 'finanzen', 'write'));


-- ---------------------------------------------------------------- invoice_items
alter table public.invoice_items enable row level security;

drop policy if exists "invoice_items_own_all" on public.invoice_items;
drop policy if exists "shared_users_delete" on public.invoice_items;
drop policy if exists "shared_users_insert" on public.invoice_items;
drop policy if exists "shared_users_select" on public.invoice_items;
drop policy if exists "shared_users_update" on public.invoice_items;
drop policy if exists invoice_items_select on public.invoice_items;
drop policy if exists invoice_items_insert on public.invoice_items;
drop policy if exists invoice_items_update on public.invoice_items;
drop policy if exists invoice_items_delete on public.invoice_items;

create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (public.has_invoice_access(invoice_id, 'finanzen', 'read'));

create policy invoice_items_insert on public.invoice_items
  for insert to authenticated
  with check (
    public.has_invoice_access(invoice_id, 'finanzen', 'write')
    and public.rls_user_ok(user_id, 'invoice', invoice_id)
  );

create policy invoice_items_update on public.invoice_items
  for update to authenticated
  using (public.has_invoice_access(invoice_id, 'finanzen', 'write'))
  with check (public.has_invoice_access(invoice_id, 'finanzen', 'write'));

create policy invoice_items_delete on public.invoice_items
  for delete to authenticated
  using (public.has_invoice_access(invoice_id, 'finanzen', 'write'));


-- ---------------------------------------------------------------- invoice_counters
alter table public.invoice_counters enable row level security;

drop policy if exists "invoice_counters_own_all" on public.invoice_counters;
drop policy if exists "shared_users_access" on public.invoice_counters;
drop policy if exists invoice_counters_select on public.invoice_counters;
drop policy if exists invoice_counters_insert on public.invoice_counters;
drop policy if exists invoice_counters_update on public.invoice_counters;
drop policy if exists invoice_counters_delete on public.invoice_counters;

create policy invoice_counters_select on public.invoice_counters
  for select to authenticated
  using (public.has_portfolio_access(portfolio_id, 'finanzen', 'read'));

create policy invoice_counters_insert on public.invoice_counters
  for insert to authenticated
  with check (
    public.has_portfolio_access(portfolio_id, 'finanzen', 'write')
    and (object_unit_id is null or public.has_unit_access(object_unit_id, 'finanzen', 'write'))
    and public.rls_user_ok(user_id, 'portfolio', portfolio_id)
  );

create policy invoice_counters_update on public.invoice_counters
  for update to authenticated
  using (public.has_portfolio_access(portfolio_id, 'finanzen', 'write'))
  with check (
    public.has_portfolio_access(portfolio_id, 'finanzen', 'write')
    and (object_unit_id is null or public.has_unit_access(object_unit_id, 'finanzen', 'write'))
  );

create policy invoice_counters_delete on public.invoice_counters
  for delete to authenticated
  using (public.has_portfolio_access(portfolio_id, 'finanzen', 'write'));


-- ---------------------------------------------------------------- expenses
-- Objekt-/Einheitsbezug; ohne beides (allgemeine Kosten) nur der eigene Nutzer.
alter table public.expenses enable row level security;

drop policy if exists "expenses_own_all" on public.expenses;
drop policy if exists "shared_users_access" on public.expenses;
drop policy if exists expenses_select on public.expenses;
drop policy if exists expenses_insert on public.expenses;
drop policy if exists expenses_update on public.expenses;
drop policy if exists expenses_delete on public.expenses;

create policy expenses_select on public.expenses
  for select to authenticated
  using (
    case
      when property_id is not null then
        public.has_property_access(property_id, 'finanzen', 'read')
        or public.has_property_access(property_id, 'nebenkosten', 'read')
      when unit_id is not null then
        public.has_unit_access(unit_id, 'finanzen', 'read')
        or public.has_unit_access(unit_id, 'nebenkosten', 'read')
      else user_id = (select auth.uid())
    end
  );

create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    case
      when property_id is not null then
        public.has_property_access(property_id, 'finanzen', 'write')
        and public.rls_user_ok(user_id, 'property', property_id)
      when unit_id is not null then
        public.has_unit_access(unit_id, 'finanzen', 'write')
        and public.rls_user_ok(user_id, 'unit', unit_id)
      else user_id = (select auth.uid())
    end
    and (unit_id is null or public.has_unit_access(unit_id, 'finanzen', 'write'))
  );

create policy expenses_update on public.expenses
  for update to authenticated
  using (
    case
      when property_id is not null then public.has_property_access(property_id, 'finanzen', 'write')
      when unit_id is not null then public.has_unit_access(unit_id, 'finanzen', 'write')
      else user_id = (select auth.uid())
    end
  )
  with check (
    case
      when property_id is not null then public.has_property_access(property_id, 'finanzen', 'write')
      when unit_id is not null then public.has_unit_access(unit_id, 'finanzen', 'write')
      else user_id = (select auth.uid())
    end
    and (unit_id is null or public.has_unit_access(unit_id, 'finanzen', 'write'))
  );

create policy expenses_delete on public.expenses
  for delete to authenticated
  using (
    case
      when property_id is not null then public.has_property_access(property_id, 'finanzen', 'write')
      when unit_id is not null then public.has_unit_access(unit_id, 'finanzen', 'write')
      else user_id = (select auth.uid())
    end
  );


-- ---------------------------------------------------------------- loans
alter table public.loans enable row level security;

drop policy if exists "shared_users_access" on public.loans;
drop policy if exists "Users can delete their own loans" on public.loans;
drop policy if exists "Users can insert their own loans" on public.loans;
drop policy if exists "Users can view their own loans" on public.loans;
drop policy if exists "Users can update their own loans" on public.loans;
drop policy if exists loans_select on public.loans;
drop policy if exists loans_insert on public.loans;
drop policy if exists loans_update on public.loans;
drop policy if exists loans_delete on public.loans;

create policy loans_select on public.loans
  for select to authenticated
  using (
    public.has_portfolio_access(portfolio_id, 'finanzen', 'read')
    or public.has_portfolio_access(portfolio_id, 'investorportal', 'read')
  );

create policy loans_insert on public.loans
  for insert to authenticated
  with check (
    (public.has_portfolio_access(portfolio_id, 'finanzen', 'write')
     or public.has_portfolio_access(portfolio_id, 'investorportal', 'write'))
    and (property_id is null
         or public.has_property_access(property_id, 'finanzen', 'write')
         or public.has_property_access(property_id, 'investorportal', 'write'))
    and (economic_unit_id is null
         or public.has_economic_unit_access(economic_unit_id, 'finanzen', 'write')
         or public.has_economic_unit_access(economic_unit_id, 'investorportal', 'write'))
    and public.rls_user_ok(user_id, 'portfolio', portfolio_id)
  );

create policy loans_update on public.loans
  for update to authenticated
  using (
    public.has_portfolio_access(portfolio_id, 'finanzen', 'write')
    or public.has_portfolio_access(portfolio_id, 'investorportal', 'write')
  )
  with check (
    (public.has_portfolio_access(portfolio_id, 'finanzen', 'write')
     or public.has_portfolio_access(portfolio_id, 'investorportal', 'write'))
    and (property_id is null
         or public.has_property_access(property_id, 'finanzen', 'write')
         or public.has_property_access(property_id, 'investorportal', 'write'))
    and (economic_unit_id is null
         or public.has_economic_unit_access(economic_unit_id, 'finanzen', 'write')
         or public.has_economic_unit_access(economic_unit_id, 'investorportal', 'write'))
  );

create policy loans_delete on public.loans
  for delete to authenticated
  using (
    public.has_portfolio_access(portfolio_id, 'finanzen', 'write')
    or public.has_portfolio_access(portfolio_id, 'investorportal', 'write')
  );


-- ---------------------------------------------------------------- deals
-- Ohne Portfolio: nur der eigene Nutzer.
alter table public.deals enable row level security;

drop policy if exists "Users can manage own deals" on public.deals;
drop policy if exists "shared_users_access" on public.deals;
drop policy if exists deals_select on public.deals;
drop policy if exists deals_insert on public.deals;
drop policy if exists deals_update on public.deals;
drop policy if exists deals_delete on public.deals;

create policy deals_select on public.deals
  for select to authenticated
  using (
    case when portfolio_id is null then user_id = (select auth.uid())
         else public.has_portfolio_access(portfolio_id, 'investorportal', 'read') end
  );

create policy deals_insert on public.deals
  for insert to authenticated
  with check (
    case when portfolio_id is null then user_id = (select auth.uid())
         else public.has_portfolio_access(portfolio_id, 'investorportal', 'write')
              and public.rls_user_ok(user_id, 'portfolio', portfolio_id) end
  );

create policy deals_update on public.deals
  for update to authenticated
  using (
    case when portfolio_id is null then user_id = (select auth.uid())
         else public.has_portfolio_access(portfolio_id, 'investorportal', 'write') end
  )
  with check (
    case when portfolio_id is null then user_id = (select auth.uid())
         else public.has_portfolio_access(portfolio_id, 'investorportal', 'write') end
  );

create policy deals_delete on public.deals
  for delete to authenticated
  using (
    case when portfolio_id is null then user_id = (select auth.uid())
         else public.has_portfolio_access(portfolio_id, 'investorportal', 'write') end
  );


