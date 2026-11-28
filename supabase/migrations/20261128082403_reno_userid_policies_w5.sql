-- =============================================================================
-- Welle 5c – Paket X_RENO_USERID_POLICIES
-- user_id beim Ändern: renovation_projects, Projekt-/Kalkulations-Unterdaten, floor_plans
--
-- Befund (Folgepunkt aus S_RENO_POLICY, Muster wie 11_reno_calc_update_policy): Die
-- Update-Policies prüfen user_id nicht, beim Anlegen dagegen schon (rls_user_ok). Ein
-- Bearbeiter mit Schreibrecht kann user_id eines Datensatzes des Eigentümers auf ein
-- beliebiges fremdes Konto setzen. Live nachgewiesen am 2026-11-28 (tests/20_…pre.sql,
-- Ergebnis "PRE: LUECKEN BESTAETIGT"):
--   * renovation_projects: Das fremde Konto sieht das Projekt danach (SELECT über user_id)
--     und bekommt über has_renovation_project_access (p.user_id = auth.uid()) Lese- UND
--     Schreibrecht auf alle Unterdaten (Gewerke, Untergewerke, Rechnungen, Aufgaben,
--     Meilensteine) sowie Leserecht auf die dort verknüpften Kontakte (contacts_select über
--     responsible_contact_id).
--   * renovation_projects, ähnliche Lücke: Verschiebt ein Bearbeiter mit Schreibrecht bei zwei
--     Eigentümern ein Projekt auf ein Objekt des anderen Eigentümers, bleibt die alte user_id
--     stehen. Der bisherige Eigentümer behält so Zugriff auf Projekt und Unterdaten.
--   * floor_plans: user_id lässt sich auf ein fremdes Konto setzen. Wird das Objekt gelöscht
--     (ON DELETE SET NULL, Einheiten per CASCADE), sieht nur noch das user_id-Konto den Plan –
--     dann das fremde Konto (samt Hintergrundbildern über floorplan_backgrounds_read).
--     Gleiches gilt beim Umhängen auf ein Objekt eines anderen Eigentümers (Grundriss-
--     Bibliothek): die alte user_id bleibt stehen.
--   * renovation_calc_trades/_calc_subtrades, renovation_project_trades/_project_subtrades,
--     renovation_invoices, renovation_tasks, renovation_milestones: user_id lässt sich ebenfalls
--     frei setzen. Lesen geht dort nur über den übergeordneten Datensatz, also kein
--     Datenabfluss; aber ON DELETE CASCADE am fremden Konto und Benachrichtigungen
--     (.eq('user_id', …)) hängen dann am falschen Konto.
--   Nicht betroffen: renovation_trades, renovation_subtrades, renovation_milestone_templates
--   (Trigger keep_user_id_on_update hält user_id fest), renovation_calculations (Paket 11, live).
--
-- Korrektur (keine neuen Rechte, SELECT/INSERT/DELETE unverändert, App schreibt user_id beim
-- Ändern nie):
--   a) renovation_projects
--      - Update-Policy WITH CHECK zusätzlich (wie 11):
--          rls_user_ok(user_id, 'property', property_id)          -- eigenes Konto / Eigentümer
--       or rls_user_ok(user_id, 'renovation_project', id)         -- bisherige user_id bzw. Eigentümer
--                                                                 --  des bisherigen Objekts (alte Zeile)
--        USING unverändert.
--      - Trigger trg_renovation_projects_same_owner (nur bei Objektwechsel): Verschieben nur
--        innerhalb desselben Eigentümers, sonst 42501 – wie set_owner_user_id bei Objekten,
--        Einheiten, Mietverträgen. Die App verschiebt Projekte nicht.
--   b) Unterdaten (7 Tabellen): Trigger trg_<tabelle>_user_id_guard, nur wenn sich user_id
--      ändert. Neue user_id muss wie beim Anlegen rls_user_ok gegen den übergeordneten
--      Datensatz erfüllen (eigenes Konto, Eigentümer, user_id des Projekts/der Kalkulation),
--      sonst 42501. Unveränderte user_id (auch bei Altbestand/Umhängen) bleibt immer erlaubt.
--      (WITH CHECK sieht die alte Zeile nur über eine Selbstabfrage der Tabelle. Der Trigger
--      läuft dagegen nur, wenn sich user_id ändert, und die Policies bleiben textgleich.)
--   c) floor_plans: Trigger trg_floor_plans_user_id_guard (bei Änderung von user_id,
--      property_id oder unit_id). Maßgeblich ist die Zuordnung wie in den Policies (Objekt,
--      sonst Einheit, ohne beides gilt die Policy user_id = auth.uid()):
--        - user_id passt (eigenes Konto/Eigentümer) -> ok
--        - user_id geändert auf ein anderes Konto   -> 42501
--        - user_id unverändert, Zuordnung gleich    -> ok (Plan eines Teammitglieds)
--        - user_id unverändert, neu zugeordnet       -> user_id := Eigentümer der neuen Zuordnung
--   Alle Trigger greifen nur bei current_user = authenticated. ON DELETE SET NULL (läuft als
--   Tabelleneigentümer), RPCs (SECURITY DEFINER) und Server/Admin bleiben unberührt.
--   Die Rechteprüfung selbst bleibt bei RLS (USING lässt nur Bearbeiter mit Schreibrecht an
--   die Zeile; Leserecht und fremde Konten erreichen die Trigger nicht).
--
-- Idempotent (drop … if exists / create or replace). Trigger-Funktionen SECURITY INVOKER,
-- search_path = public, pg_temp, kein EXECUTE für public/anon/authenticated.
-- Rollback: rollback/20_reno_userid_policies.rollback.sql
-- Tests:    tests/20_reno_userid_policies.test.sql (Gegenprobe ohne Migration: tests/20_…pre.sql)
-- =============================================================================

-- a) renovation_projects ------------------------------------------------------
drop policy if exists renovation_projects_update on public.renovation_projects;
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
        and (public.rls_user_ok(user_id, 'property', property_id)
             or public.rls_user_ok(user_id, 'renovation_project', id))
    );

create or replace function public.renovation_projects_same_owner_on_move()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
declare
    v_old_owner uuid;
    v_new_owner uuid;
begin
    -- Nur direkte Änderungen angemeldeter Nutzer; RPCs (SECURITY DEFINER), Server und Admin
    -- bleiben unberührt.
    if current_user <> 'authenticated' or auth.uid() is null then
        return new;
    end if;

    select po.user_id into v_old_owner
      from public.properties pr
      join public.portfolios po on po.id = pr.portfolio_id
     where pr.id = old.property_id;
    select po.user_id into v_new_owner
      from public.properties pr
      join public.portfolios po on po.id = pr.portfolio_id
     where pr.id = new.property_id;

    -- Wie bei Objekten/Einheiten/Mietverträgen (set_owner_user_id): nur innerhalb desselben
    -- Eigentümers. Sonst bliebe die alte user_id stehen und der bisherige Eigentümer behielte
    -- über has_renovation_project_access Zugriff auf Projekt und Unterdaten.
    if v_old_owner is null or v_new_owner is null or v_old_owner <> v_new_owner then
        raise exception 'Sanierungsprojekte können nur zu Objekten desselben Eigentümers verschoben werden.'
            using errcode = '42501';
    end if;
    return new;
end;
$function$;

revoke execute on function public.renovation_projects_same_owner_on_move()
    from public, anon, authenticated;

drop trigger if exists trg_renovation_projects_same_owner on public.renovation_projects;
create trigger trg_renovation_projects_same_owner
    before update on public.renovation_projects
    for each row
    when (old.property_id is distinct from new.property_id)
    execute function public.renovation_projects_same_owner_on_move();

-- b) Unterdaten von Projekten und Kalkulationen -------------------------------
create or replace function public.renovation_user_id_guard()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
declare
    v_kind text;
    v_ref uuid;
begin
    -- Nur direkte Änderungen angemeldeter Nutzer; RPCs (SECURITY DEFINER), Server und Admin
    -- bleiben unberührt.
    if current_user <> 'authenticated' or auth.uid() is null then
        return new;
    end if;

    -- Übergeordneter Datensatz wie in der jeweiligen Insert-Policy
    case tg_table_name
        when 'renovation_project_trades', 'renovation_project_subtrades',
             'renovation_invoices', 'renovation_tasks' then
            v_kind := 'renovation_project';
            v_ref := new.project_id;
        when 'renovation_milestones' then
            v_kind := 'renovation_project';
            select t.project_id into v_ref
              from public.renovation_project_trades t
             where t.id = new.project_trade_id;
        when 'renovation_calc_trades' then
            v_kind := 'renovation_calculation';
            v_ref := new.calculation_id;
        when 'renovation_calc_subtrades' then
            v_kind := 'renovation_calculation';
            select t.calculation_id into v_ref
              from public.renovation_calc_trades t
             where t.id = new.calc_trade_id;
        else
            raise exception 'renovation_user_id_guard: Tabelle % ist nicht vorgesehen', tg_table_name;
    end case;

    -- Neue user_id: eigenes Konto, Eigentümer oder user_id des Projekts/der Kalkulation
    -- (wie beim Anlegen). Ein beliebiges fremdes Konto nicht.
    if not public.rls_user_ok(new.user_id, v_kind, v_ref) then
        raise exception 'user_id kann nur auf das eigene Konto oder den Eigentümer der Daten geändert werden.'
            using errcode = '42501';
    end if;
    return new;
end;
$function$;

revoke execute on function public.renovation_user_id_guard()
    from public, anon, authenticated;

drop trigger if exists trg_renovation_project_trades_user_id_guard on public.renovation_project_trades;
create trigger trg_renovation_project_trades_user_id_guard
    before update on public.renovation_project_trades
    for each row when (old.user_id is distinct from new.user_id)
    execute function public.renovation_user_id_guard();

drop trigger if exists trg_renovation_project_subtrades_user_id_guard on public.renovation_project_subtrades;
create trigger trg_renovation_project_subtrades_user_id_guard
    before update on public.renovation_project_subtrades
    for each row when (old.user_id is distinct from new.user_id)
    execute function public.renovation_user_id_guard();

drop trigger if exists trg_renovation_invoices_user_id_guard on public.renovation_invoices;
create trigger trg_renovation_invoices_user_id_guard
    before update on public.renovation_invoices
    for each row when (old.user_id is distinct from new.user_id)
    execute function public.renovation_user_id_guard();

drop trigger if exists trg_renovation_tasks_user_id_guard on public.renovation_tasks;
create trigger trg_renovation_tasks_user_id_guard
    before update on public.renovation_tasks
    for each row when (old.user_id is distinct from new.user_id)
    execute function public.renovation_user_id_guard();

drop trigger if exists trg_renovation_milestones_user_id_guard on public.renovation_milestones;
create trigger trg_renovation_milestones_user_id_guard
    before update on public.renovation_milestones
    for each row when (old.user_id is distinct from new.user_id)
    execute function public.renovation_user_id_guard();

drop trigger if exists trg_renovation_calc_trades_user_id_guard on public.renovation_calc_trades;
create trigger trg_renovation_calc_trades_user_id_guard
    before update on public.renovation_calc_trades
    for each row when (old.user_id is distinct from new.user_id)
    execute function public.renovation_user_id_guard();

drop trigger if exists trg_renovation_calc_subtrades_user_id_guard on public.renovation_calc_subtrades;
create trigger trg_renovation_calc_subtrades_user_id_guard
    before update on public.renovation_calc_subtrades
    for each row when (old.user_id is distinct from new.user_id)
    execute function public.renovation_user_id_guard();

-- c) floor_plans --------------------------------------------------------------
create or replace function public.floor_plans_user_id_guard()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
declare
    v_kind text;
    v_ref uuid;
    v_old_kind text;
    v_old_ref uuid;
    v_owner uuid;
begin
    -- Nur direkte Änderungen angemeldeter Nutzer. ON DELETE SET NULL beim Löschen eines
    -- Objekts/einer Einheit (läuft als Tabelleneigentümer), RPCs und Server bleiben unberührt.
    if current_user <> 'authenticated' or auth.uid() is null then
        return new;
    end if;

    -- Maßgeblich ist wie in den Policies die Zuordnung: Objekt, sonst Einheit.
    if new.property_id is not null then
        v_kind := 'property';
        v_ref := new.property_id;
    elsif new.unit_id is not null then
        v_kind := 'unit';
        v_ref := new.unit_id;
    else
        -- Ohne Zuordnung verlangt die Update-Policy ohnehin user_id = auth.uid().
        return new;
    end if;

    -- Eigenes Konto oder Eigentümer der Zuordnung: wie beim Anlegen erlaubt.
    if public.rls_user_ok(new.user_id, v_kind, v_ref) then
        return new;
    end if;

    -- Ein anderes Konto nur, wenn user_id unverändert bleibt …
    if new.user_id is distinct from old.user_id then
        raise exception 'user_id kann nur auf das eigene Konto oder den Eigentümer der Daten geändert werden.'
            using errcode = '42501';
    end if;

    -- … und die Zuordnung gleich bleibt (z. B. Plan eines Teammitglieds bearbeiten).
    if old.property_id is not null then
        v_old_kind := 'property';
        v_old_ref := old.property_id;
    elsif old.unit_id is not null then
        v_old_kind := 'unit';
        v_old_ref := old.unit_id;
    end if;
    if v_old_kind is not distinct from v_kind and v_old_ref is not distinct from v_ref then
        return new;
    end if;

    -- Neu zugeordnet und die bisherige user_id passt nicht: Eigentümer der neuen Zuordnung,
    -- sonst fiele der Plan beim Löschen des Objekts an das bisherige Konto zurück.
    if v_kind = 'property' then
        select po.user_id into v_owner
          from public.properties pr
          join public.portfolios po on po.id = pr.portfolio_id
         where pr.id = v_ref;
    else
        select po.user_id into v_owner
          from public.units u
          join public.properties pr on pr.id = u.property_id
          join public.portfolios po on po.id = pr.portfolio_id
         where u.id = v_ref;
    end if;
    new.user_id := coalesce(v_owner, auth.uid());
    return new;
end;
$function$;

revoke execute on function public.floor_plans_user_id_guard()
    from public, anon, authenticated;

drop trigger if exists trg_floor_plans_user_id_guard on public.floor_plans;
create trigger trg_floor_plans_user_id_guard
    before update on public.floor_plans
    for each row
    when (old.user_id is distinct from new.user_id
          or old.property_id is distinct from new.property_id
          or old.unit_id is distinct from new.unit_id)
    execute function public.floor_plans_user_id_guard();
