-- =============================================================================
-- Welle 7 – Paket investor-2
-- Nachrichten (Vermieter-Ansicht, /investor-messages): Gesprächspartner nach Recht „mieterportal“
--
-- Befunde:
--   C-19  Die Gesprächsliste las user_roles (role = 'tenant') direkt. Die Policy
--         user_roles_select_landlord gibt diese Zeilen nur mit Leserecht „mietverhaeltnisse“
--         frei, die Route (InvestorRoute) und das Senden (rls_message_allowed) richten sich aber
--         nach „mieterportal“. Ein Mitnutzer nur mit „mieterportal“ sah „Keine Mieter registriert“.
--         Außerdem fehlte portfolio_id für den Portfolio-Filter der Seite.
--   C-21  (App) Lesemodus: can_write liefert genau die Sende-Prüfung von rls_message_allowed
--         (Schreibrecht „mieterportal“ auf das Objekt der Mieterrolle).
--
-- Korrektur: neue Funktion public.get_message_partners() (SECURITY DEFINER, nur lesend).
--   Liefert je Mieter-Konto (user_roles.role = 'tenant', property_id gesetzt), bei dem der
--   Aufrufer Leserecht „mieterportal“ auf das Objekt hat (has_property_access):
--   user_id, tenant_id, unit_id, property_id, portfolio_id, Vor-/Nachname des Mieters,
--   Einheit, Straße/Hausnummer und can_write (= has_property_access(…, 'mieterportal', 'write')).
--   Das eigene Konto wird nie geliefert (an sich selbst schreiben lehnt rls_message_allowed ab).
--   Einheit nur, wenn sie zum Objekt der Rolle gehört.
--   Keine Policy wird geändert; user_roles_select_landlord bleibt wie heute.
--
-- Rechte: revoke from public, anon; grant authenticated, service_role.
-- App: InvestorMessages.jsx ruft die Funktion auf und fällt auf das direkte Lesen von
--      user_roles zurück, solange die Funktion fehlt (PGRST202/42883/404).
-- Idempotent (create or replace).
-- =============================================================================

create or replace function public.get_message_partners()
returns table (
    user_id uuid,
    tenant_id uuid,
    unit_id uuid,
    property_id uuid,
    portfolio_id uuid,
    first_name text,
    last_name text,
    unit_name text,
    street text,
    house_number text,
    can_write boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select ur.user_id,
           ur.tenant_id,
           ur.unit_id,
           ur.property_id,
           pr.portfolio_id,
           t.first_name,
           t.last_name,
           u.unit_name,
           pr.street,
           pr.house_number,
           public.has_property_access(ur.property_id, 'mieterportal', 'write') as can_write
    from public.user_roles ur
    join public.properties pr on pr.id = ur.property_id
    left join public.units u on u.id = ur.unit_id and u.property_id = ur.property_id
    left join public.tenants t on t.id = ur.tenant_id
    where (select auth.uid()) is not null
      and ur.role = 'tenant'
      and ur.user_id <> (select auth.uid())
      and public.has_property_access(ur.property_id, 'mieterportal', 'read')
    order by ur.created_at desc nulls last
$$;

comment on function public.get_message_partners() is
    'Nachrichten (Vermieter-Ansicht): Mieter-Konten in Objekten mit Leserecht mieterportal, can_write = Schreibrecht mieterportal (W7, C-19/C-21).';

revoke execute on function public.get_message_partners() from public, anon;
grant execute on function public.get_message_partners() to authenticated, service_role;
