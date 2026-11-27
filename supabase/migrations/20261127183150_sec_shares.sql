-- =============================================================================
-- Paket SEC-SHARES (Komplett-Check 2026-11-27)
--
-- Portfolio-Freigaben absichern und Grunddaten-Policies auf die rechte-bewussten
-- Prüf-Funktionen des Fundaments umstellen.
--
-- Befunde:
--   D3a-01, D3b-01, X2-01   Freigabe per UPDATE auf fremdes Portfolio umhängen / selbst annehmen
--   D2-05 (Teil)            Freigabe-INSERT nur noch mit status = 'pending'
--   G02-01, D2-06, D3a-03,  Freigabe-Rechte (none/read/write je Kategorie) werden für
--   D3b-03, R1-03, X2-04    portfolios/properties/units/economic_units jetzt durchgesetzt
--   G04-01, G04-02, R1-02   Portfolio ändern/löschen nur noch durch den Eigentümer,
--                           Hauptportfolio nicht löschbar, kein Anlegen im Namen des Eigentümers
--   G12a-02, D3a-12 (Teil)  user_id auf portfolios/properties/units/economic_units unveränderlich;
--                           neue Objekte/Einheiten gehören immer dem Portfolio-Eigentümer
--   G02-05, X2-16           check_user_exists_by_email nur für angemeldete Aufrufer
--   G02-10                  E-Mail-Vergleich der Freigaben ohne Groß-/Kleinschreibung
--   R1-04, D2-15, D3a-11    is_user_shared_with_me: nur vom Eigentümer erstellte Freigaben mit
--   (Teil)                  mindestens einem Leserecht; nicht mehr als Schreib-CHECK auf meinen Tabellen
--   D2-22 (Teil)            search_path für alle Funktionen dieses Pakets
--   X2-14, D3b-21           Ersetzt den Stand der losen Datei supabase_migration_portfolio_shares.sql
--
-- Voraussetzung: immo-web/supabase/migrations/20261127100000_sec_access_helpers.sql
--                (share_permits, has_portfolio_access/has_property_access/
--                 has_economic_unit_access mit 3 Parametern) ist eingespielt.
--
-- Unverändert bleiben bewusst die Mieter-Policies
--   portfolios."Tenants can view their property portfolio",
--   properties.tenants_read_own_property, units.tenants_read_own_unit
-- (Mieterportal; Spalten-Einschränkung ist Sache von SEC-ROLES/SEC-LETTING).
--
-- Live-Stand am 27.11.2026 (nur Zählungen): 1 Freigabe (accepted, Rechte gesetzt),
-- 0 Freigaben mit created_by <> Portfolio-Eigentümer, 0 Objekte/Einheiten mit
-- user_id <> Portfolio-Eigentümer. Die Umstellung entzieht also niemandem Daten.
--
-- Idempotent: create or replace / drop ... if exists.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. portfolio_shares: Schutz-Trigger
--    * shared_with_email wird immer klein geschrieben und getrimmt gespeichert.
--    * Bei direkten Client-Zugriffen (Rollen authenticated/anon) sind
--      portfolio_id, created_by und shared_with_email nach dem Anlegen
--      unveränderlich (alter Wert bleibt still erhalten), und status kann nur
--      auf 'pending' zurückgesetzt, aber nie selbst auf 'accepted' gesetzt
--      werden. Annehmen geht ausschließlich über accept_portfolio_share()
--      (SECURITY DEFINER, läuft als Funktions-Eigentümer, nicht als authenticated).
--    Absichtlich SECURITY INVOKER: current_user muss die Rolle des Aufrufers sein.
-- -----------------------------------------------------------------------------
create or replace function public.portfolio_shares_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
    new.shared_with_email := lower(btrim(new.shared_with_email));

    if current_user not in ('authenticated', 'anon') then
        return new;
    end if;

    if tg_op = 'UPDATE' then
        new.portfolio_id      := old.portfolio_id;
        new.created_by        := old.created_by;
        new.shared_with_email := old.shared_with_email;
        if new.status is distinct from old.status and new.status <> 'pending' then
            new.status := old.status;
        end if;
        new.updated_at := now();
    end if;

    return new;
end;
$$;

drop trigger if exists portfolio_shares_guard on public.portfolio_shares;
create trigger portfolio_shares_guard
    before insert or update on public.portfolio_shares
    for each row execute function public.portfolio_shares_guard();


-- -----------------------------------------------------------------------------
-- 2. portfolio_shares: Policies
--    Lesen:     Portfolio-Eigentümer + Empfänger
--    Anlegen:   nur Portfolio-Eigentümer, nur status = 'pending', created_by = auth.uid()
--    Ändern:    nur Portfolio-Eigentümer (Portfolio bleibt sein eigenes; Status siehe Trigger)
--    Löschen:   Portfolio-Eigentümer, Ersteller oder Empfänger (Ablehnen/Verlassen)
-- -----------------------------------------------------------------------------
alter table public.portfolio_shares enable row level security;

drop policy if exists "Users can delete shares they created" on public.portfolio_shares;
drop policy if exists "Users can insert shares for their own portfolios" on public.portfolio_shares;
drop policy if exists "Users can view shares targeted to their email" on public.portfolio_shares;
drop policy if exists "Users can view shares they created" on public.portfolio_shares;
drop policy if exists "Users can update shares they created" on public.portfolio_shares;
drop policy if exists portfolio_shares_select on public.portfolio_shares;
drop policy if exists portfolio_shares_insert on public.portfolio_shares;
drop policy if exists portfolio_shares_update on public.portfolio_shares;
drop policy if exists portfolio_shares_delete on public.portfolio_shares;

create policy portfolio_shares_select on public.portfolio_shares
    for select to authenticated
    using (
        exists (select 1 from public.portfolios p
                where p.id = portfolio_shares.portfolio_id and p.user_id = auth.uid())
        or lower(portfolio_shares.shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );

create policy portfolio_shares_insert on public.portfolio_shares
    for insert to authenticated
    with check (
        created_by = auth.uid()
        and status = 'pending'
        and exists (select 1 from public.portfolios p
                    where p.id = portfolio_shares.portfolio_id and p.user_id = auth.uid())
    );

create policy portfolio_shares_update on public.portfolio_shares
    for update to authenticated
    using (
        exists (select 1 from public.portfolios p
                where p.id = portfolio_shares.portfolio_id and p.user_id = auth.uid())
    )
    with check (
        exists (select 1 from public.portfolios p
                where p.id = portfolio_shares.portfolio_id and p.user_id = auth.uid())
    );

create policy portfolio_shares_delete on public.portfolio_shares
    for delete to authenticated
    using (
        created_by = auth.uid()
        or exists (select 1 from public.portfolios p
                   where p.id = portfolio_shares.portfolio_id and p.user_id = auth.uid())
        or lower(portfolio_shares.shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );


-- -----------------------------------------------------------------------------
-- 3. Einladungs-Funktionen (Signaturen unverändert)
-- -----------------------------------------------------------------------------

-- Annehmen: nur der Empfänger (JWT-E-Mail, ohne Groß-/Kleinschreibung), nur offene
-- Einladungen, nur vom Portfolio-Eigentümer erstellte Freigaben, nur mit bestätigter
-- Konto-E-Mail. Rückgabe false, wenn nichts angenommen wurde (wie bisher).
create or replace function public.accept_portfolio_share(share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
begin
    if auth.uid() is null or v_email = '' then
        return false;
    end if;

    if not exists (select 1 from auth.users u
                   where u.id = auth.uid() and u.email_confirmed_at is not null) then
        return false;
    end if;

    update public.portfolio_shares s
       set status = 'accepted',
           updated_at = now()
     where s.id = accept_portfolio_share.share_id
       and s.status = 'pending'
       and lower(s.shared_with_email) = v_email
       and exists (select 1 from public.portfolios p
                   where p.id = s.portfolio_id and p.user_id = s.created_by);

    return found;
end;
$$;

-- Ablehnen bzw. Freigabe verlassen: nur der Empfänger.
create or replace function public.decline_portfolio_share(share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
begin
    if auth.uid() is null or v_email = '' then
        raise exception 'Not authorized' using errcode = '42501';
    end if;

    delete from public.portfolio_shares s
     where s.id = decline_portfolio_share.share_id
       and lower(s.shared_with_email) = v_email;

    if not found then
        raise exception 'Not authorized' using errcode = '42501';
    end if;

    return true;
end;
$$;

create or replace function public.get_pending_invitations()
returns table(id uuid, portfolio_id uuid, portfolio_name text, sender_name text, created_at timestamp with time zone)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
begin
    if auth.uid() is null or v_email = '' then
        return;
    end if;

    return query
    select
        ps.id,
        ps.portfolio_id,
        p.name as portfolio_name,
        coalesce(pr.first_name || ' ' || pr.last_name, p.company_name, 'Unbekannt') as sender_name,
        ps.created_at
    from public.portfolio_shares ps
    join public.portfolios p on p.id = ps.portfolio_id
    left join public.profiles pr on pr.id = p.user_id
    where lower(ps.shared_with_email) = v_email
      and ps.status = 'pending'
      and p.user_id = ps.created_by;
end;
$$;

-- Nur für angemeldete Aufrufer (kein Konten-Abgleich ohne Login mehr).
create or replace function public.check_user_exists_by_email(check_email text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null then
        raise exception 'Not authorized' using errcode = '42501';
    end if;

    if check_email is null or btrim(check_email) = '' then
        return false;
    end if;

    return exists (
        select 1 from auth.users u
        where lower(u.email) = lower(btrim(check_email))
    );
end;
$$;

-- Bedeutung wie bisher ("Aufrufer ist Mitnutzer irgendeines Portfolios von check_user_id"),
-- aber nur noch für vom Eigentümer selbst erstellte, angenommene Freigaben mit
-- mindestens einem Lese- oder Schreibrecht. Für neue Policies nicht mehr verwenden.
create or replace function public.is_user_shared_with_me(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select auth.uid() is not null
       and check_user_id is not null
       and exists (
           select 1
           from public.portfolio_shares ps
           join public.portfolios p on p.id = ps.portfolio_id
           where p.user_id = check_user_id
             and ps.created_by = p.user_id
             and ps.status = 'accepted'
             and lower(ps.shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
             and public.share_permits(ps.permissions, '*', 'read')
       )
$$;


-- -----------------------------------------------------------------------------
-- 4. user_id unveränderlich / Daten bleiben beim Eigentümer
-- -----------------------------------------------------------------------------

-- portfolios, economic_units: user_id bei UPDATE still auf dem alten Wert halten.
create or replace function public.keep_user_id_on_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
    if tg_op = 'UPDATE' then
        new.user_id := old.user_id;
    end if;
    return new;
end;
$$;

drop trigger if exists keep_user_id_on_update on public.portfolios;
create trigger keep_user_id_on_update
    before update on public.portfolios
    for each row execute function public.keep_user_id_on_update();

drop trigger if exists keep_user_id_on_update on public.economic_units;
create trigger keep_user_id_on_update
    before update on public.economic_units
    for each row execute function public.keep_user_id_on_update();

-- properties, units:
--   INSERT: user_id = Eigentümer des Portfolios (auch wenn ein Mitnutzer anlegt;
--           die App schreibt heute die eigene Nutzer-ID mit).
--   UPDATE: user_id bleibt still erhalten; ein Verschieben in ein Portfolio bzw.
--           Objekt eines anderen Eigentümers wird abgelehnt.
-- SECURITY DEFINER, damit der Eigentümer unabhängig von RLS ermittelt wird; die
-- Zugriffsprüfung selbst machen die Policies.
create or replace function public.set_owner_user_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_owner uuid;
    v_moved boolean := false;
begin
    if tg_table_name = 'properties' then
        select po.user_id into v_owner
          from public.portfolios po
         where po.id = new.portfolio_id;
        if tg_op = 'UPDATE' then
            v_moved := new.portfolio_id is distinct from old.portfolio_id;
        end if;
    elsif tg_table_name = 'units' then
        select po.user_id into v_owner
          from public.properties pr
          join public.portfolios po on po.id = pr.portfolio_id
         where pr.id = new.property_id;
        if tg_op = 'UPDATE' then
            v_moved := new.property_id is distinct from old.property_id;
        end if;
    end if;

    if tg_op = 'INSERT' then
        if v_owner is not null then
            new.user_id := v_owner;
        end if;
        return new;
    end if;

    new.user_id := old.user_id;
    if v_moved and v_owner is not null and v_owner <> old.user_id then
        raise exception 'Datensätze können nur innerhalb der Portfolios desselben Eigentümers verschoben werden.'
            using errcode = '42501';
    end if;
    return new;
end;
$$;

drop trigger if exists set_owner_user_id on public.properties;
create trigger set_owner_user_id
    before insert or update on public.properties
    for each row execute function public.set_owner_user_id();

drop trigger if exists set_owner_user_id on public.units;
create trigger set_owner_user_id
    before insert or update on public.units
    for each row execute function public.set_owner_user_id();


-- -----------------------------------------------------------------------------
-- 5. portfolios: Lesen = Eigentümer oder Freigabe mit irgendeinem Recht;
--    Anlegen/Ändern/Löschen nur Eigentümer, Hauptportfolio nicht löschbar.
-- -----------------------------------------------------------------------------
alter table public.portfolios enable row level security;

drop policy if exists portfolios_own_all on public.portfolios;
drop policy if exists shared_users_delete on public.portfolios;
drop policy if exists shared_users_insert on public.portfolios;
drop policy if exists "Shared users can view portfolio" on public.portfolios;
drop policy if exists shared_users_select on public.portfolios;
drop policy if exists shared_users_update on public.portfolios;
drop policy if exists portfolios_select on public.portfolios;
drop policy if exists portfolios_insert on public.portfolios;
drop policy if exists portfolios_update on public.portfolios;
drop policy if exists portfolios_delete on public.portfolios;

create policy portfolios_select on public.portfolios
    for select to authenticated
    using (user_id = auth.uid() or public.has_portfolio_access(id, '*', 'read'));

create policy portfolios_insert on public.portfolios
    for insert to authenticated
    with check (user_id = auth.uid());

create policy portfolios_update on public.portfolios
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy portfolios_delete on public.portfolios
    for delete to authenticated
    using (user_id = auth.uid() and coalesce(is_primary, false) = false);


-- -----------------------------------------------------------------------------
-- 6. properties: Lesen mit '*'/read, Schreiben mit 'immobilien'/write.
--    Verknüpfung mit einer Wirtschaftseinheit nur, wenn diese ebenfalls
--    beschreibbar ist (kein Einhängen fremder Wirtschaftseinheiten).
-- -----------------------------------------------------------------------------
alter table public.properties enable row level security;

drop policy if exists properties_own_all on public.properties;
drop policy if exists shared_users_access on public.properties;
drop policy if exists "Users can delete their own properties" on public.properties;
drop policy if exists "Users can insert their own properties" on public.properties;
drop policy if exists "Users can view their own properties" on public.properties;
drop policy if exists "Users can update their own properties" on public.properties;
drop policy if exists properties_select on public.properties;
drop policy if exists properties_insert on public.properties;
drop policy if exists properties_update on public.properties;
drop policy if exists properties_delete on public.properties;

create policy properties_select on public.properties
    for select to authenticated
    using (public.has_portfolio_access(portfolio_id, '*', 'read'));

create policy properties_insert on public.properties
    for insert to authenticated
    with check (
        public.has_portfolio_access(portfolio_id, 'immobilien', 'write')
        and (economic_unit_id is null
             or public.has_economic_unit_access(economic_unit_id, 'immobilien', 'write'))
    );

create policy properties_update on public.properties
    for update to authenticated
    using (public.has_portfolio_access(portfolio_id, 'immobilien', 'write'))
    with check (
        public.has_portfolio_access(portfolio_id, 'immobilien', 'write')
        and (economic_unit_id is null
             or public.has_economic_unit_access(economic_unit_id, 'immobilien', 'write'))
    );

create policy properties_delete on public.properties
    for delete to authenticated
    using (public.has_portfolio_access(portfolio_id, 'immobilien', 'write'));


-- -----------------------------------------------------------------------------
-- 7. units: Lesen mit '*'/read, Schreiben mit 'immobilien'/write (über das Objekt).
-- -----------------------------------------------------------------------------
alter table public.units enable row level security;

drop policy if exists units_own_all on public.units;
drop policy if exists shared_users_access on public.units;
drop policy if exists "Users can delete their own units" on public.units;
drop policy if exists "Users can insert their own units" on public.units;
drop policy if exists "Users can view their own units" on public.units;
drop policy if exists "Users can update their own units" on public.units;
drop policy if exists units_select on public.units;
drop policy if exists units_insert on public.units;
drop policy if exists units_update on public.units;
drop policy if exists units_delete on public.units;

create policy units_select on public.units
    for select to authenticated
    using (public.has_property_access(property_id, '*', 'read'));

create policy units_insert on public.units
    for insert to authenticated
    with check (public.has_property_access(property_id, 'immobilien', 'write'));

create policy units_update on public.units
    for update to authenticated
    using (public.has_property_access(property_id, 'immobilien', 'write'))
    with check (public.has_property_access(property_id, 'immobilien', 'write'));

create policy units_delete on public.units
    for delete to authenticated
    using (public.has_property_access(property_id, 'immobilien', 'write'));


-- -----------------------------------------------------------------------------
-- 8. economic_units: Lesen mit '*'/read, Ändern/Löschen mit 'immobilien'/write.
--    Neu anlegen nur unter der eigenen Nutzer-ID (keine Portfolio-Zuordnung
--    vorhanden; is_user_shared_with_me als Schreib-CHECK entfällt).
-- -----------------------------------------------------------------------------
alter table public.economic_units enable row level security;

drop policy if exists "Users can delete their own economic units" on public.economic_units;
drop policy if exists shared_users_delete on public.economic_units;
drop policy if exists "Users can insert their own economic units" on public.economic_units;
drop policy if exists shared_users_insert on public.economic_units;
drop policy if exists "Users can view their own economic units" on public.economic_units;
drop policy if exists shared_users_select on public.economic_units;
drop policy if exists "Users can update their own economic units" on public.economic_units;
drop policy if exists shared_users_update on public.economic_units;
drop policy if exists economic_units_select on public.economic_units;
drop policy if exists economic_units_insert on public.economic_units;
drop policy if exists economic_units_update on public.economic_units;
drop policy if exists economic_units_delete on public.economic_units;

-- Mitnutzer mit 'immobilien'/write legen Wirtschaftseinheiten unter der Nutzer-ID des
-- Portfolio-Eigentümers an (Properties.jsx, InvestorPortal.jsx) und verknüpfen sie danach
-- mit einem Objekt. Noch nicht verknüpfte Einheiten des Eigentümers gelten deshalb für
-- Mitnutzer eines seiner Portfolios als zugänglich (je Kategorie/Recht).
create or replace function public.has_economic_unit_access(check_economic_unit_id uuid, category text, access_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and check_economic_unit_id is not null
     and (
       exists (select 1 from public.economic_units e
               where e.id = check_economic_unit_id and e.user_id = auth.uid())
       or exists (select 1 from public.properties pr
                  where pr.economic_unit_id = check_economic_unit_id
                    and public.has_portfolio_access(pr.portfolio_id, category, access_type))
       or (not exists (select 1 from public.properties pr
                       where pr.economic_unit_id = check_economic_unit_id)
           and exists (select 1 from public.economic_units e
                       join public.portfolios po on po.user_id = e.user_id
                       where e.id = check_economic_unit_id
                         and public.has_portfolio_access(po.id, category, access_type)))
     )
$$;

-- "Ist die Wirtschaftseinheit mit irgendeinem Objekt verknüpft?" – ohne RLS ermittelt.
-- (Prüfung 27.11.2026: Ein NOT EXISTS auf properties direkt in der Policy läuft unter der RLS
--  des Aufrufers; Objekte in nicht freigegebenen Portfolios sind dort unsichtbar, die
--  Wirtschaftseinheit wirkte dadurch "unverknüpft" und wurde Mitnutzern angezeigt.)
create or replace function public.economic_unit_is_linked(check_economic_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.properties pr
                 where pr.economic_unit_id = check_economic_unit_id)
$$;

-- Hinweis: Bei INSERT … RETURNING ist die neue Zeile für Nachschlage-Funktionen im selben
-- Statement noch unsichtbar; deshalb prüfen Lesen und Anlegen die Zeilenwerte direkt.
create policy economic_units_select on public.economic_units
    for select to authenticated
    using (
        user_id = auth.uid()
        or public.has_economic_unit_access(id, '*', 'read')
        or (not public.economic_unit_is_linked(economic_units.id)
            and exists (select 1 from public.portfolios po
                        where po.user_id = economic_units.user_id
                          and public.has_portfolio_access(po.id, 'immobilien', 'write')))
    );

create policy economic_units_insert on public.economic_units
    for insert to authenticated
    with check (
        user_id = auth.uid()
        or exists (select 1 from public.portfolios po
                   where po.user_id = economic_units.user_id
                     and public.has_portfolio_access(po.id, 'immobilien', 'write'))
    );

create policy economic_units_update on public.economic_units
    for update to authenticated
    using (public.has_economic_unit_access(id, 'immobilien', 'write'))
    with check (public.has_economic_unit_access(id, 'immobilien', 'write'));

create policy economic_units_delete on public.economic_units
    for delete to authenticated
    using (public.has_economic_unit_access(id, 'immobilien', 'write'));
