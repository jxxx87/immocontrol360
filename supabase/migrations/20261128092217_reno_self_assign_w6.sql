-- =============================================================================
-- Welle 6 – Paket AC_RENO_SELF_ASSIGN
-- Sanierung: keine Selbstzuweisung von user_id beim Ändern; Einheit muss zum Objekt passen
--
-- Befunde (Prüfung von X_RENO_USERID_POLICIES, _fixwork/wave5/reports/X_RENO_USERID_POLICIES.md,
-- Abschnitt "Prüfung", Restrisiko V10 – live bestätigt):
--   (a) Ein Mitnutzer mit Schreibrecht darf beim UPDATE user_id eines bestehenden Projekts des
--       Eigentümers (renovation_projects) und der 7 Unterdaten-Tabellen
--       (renovation_project_trades, _project_subtrades, renovation_invoices, renovation_tasks,
--       renovation_milestones, renovation_calc_trades, renovation_calc_subtrades) auf SEIN
--       EIGENES Konto setzen (Migration 20 lässt wie rls_user_ok das eigene Konto zu). Nach
--       Entzug der Freigabe behält er über has_renovation_project_access (p.user_id = auth.uid())
--       Lese- und Schreibzugriff auf Projekt und Unterdaten (Rechnungen, verknüpfte Kontakte).
--       Die App schreibt user_id beim Ändern nie (Inserts setzen den Portfolio-Eigentümer).
--   (b) renovation_calculations / renovation_projects: Beim Objektwechsel (oder Einheitenwechsel)
--       wird nicht geprüft, ob unit_id zum Objekt gehört (units.property_id). Die App leert die
--       Einheit beim Objektwechsel und bietet nur Einheiten des Objekts an; live 0 betroffene Zeilen.
--
-- Korrektur (Live-Stand nach Migration 20 = 20261128082403 und 11 = 20261128041551):
--   a1) renovation_projects: Trigger-Funktion renovation_projects_same_owner_on_move() (Migration
--       20, create or replace) prüft zusätzlich bei geänderter user_id: neue user_id muss der
--       Eigentümer des Objekts (Portfolio-Eigentümer) sein, sonst 42501. Das eigene Konto des
--       Bearbeiters also nur, wenn er der Eigentümer ist. Unveränderte user_id (Altbestand eines
--       Teammitglieds) bleibt erlaubt. Trigger trg_renovation_projects_same_owner läuft jetzt bei
--       Änderung von property_id ODER user_id. Policies (auch WITH CHECK aus 20) bleiben textgleich.
--   a2) Unterdaten (7 Tabellen): renovation_user_id_guard() (Migration 20, create or replace)
--       lässt als neue user_id nur noch den Eigentümer des Objekts oder die user_id des
--       übergeordneten Projekts bzw. der Kalkulation zu – nicht mehr pauschal das eigene Konto
--       (rls_user_ok). Trigger (nur bei geänderter user_id) unverändert.
--   renovation_calculations selbst bleibt bewusst wie Paket 11 (Entkoppeln geht an den
--   Bearbeiter, Rückfrage in der App) – Policy und Trigger dort NICHT geändert.
--   INSERT-Policies unverändert.
--   b) Neue Trigger-Funktion renovation_unit_matches_property() auf renovation_projects und
--      renovation_calculations (BEFORE INSERT OR UPDATE OF property_id, unit_id): bei gesetztem
--      property_id und unit_id muss units.property_id = property_id sein, sonst 23514. Beim
--      UPDATE nur, wenn sich unit_id oder property_id tatsächlich ändern – Altbestand bleibt
--      bearbeitbar (App sendet beide Felder beim Speichern der Kalkulation immer mit). Gilt für
--      alle Rollen (Datenregel); ON DELETE SET NULL setzt nur NULL und wird nicht geprüft.
--
-- Alle Trigger-Funktionen SECURITY INVOKER, search_path = public, pg_temp, kein EXECUTE für
-- public/anon/authenticated (Trigger brauchen es nicht). a1/a2 greifen wie bisher nur bei
-- current_user = authenticated (RPCs/Server/Admin unberührt).
-- Idempotent (create or replace / drop … if exists).
-- Rollback: rollback/29_reno_self_assign.rollback.sql (= Live-Stand nach Migration 20)
-- Tests:    tests/29_reno_self_assign.test.sql (Gegenprobe ohne Migration: tests/29_…pre.sql)
-- =============================================================================

-- a1) renovation_projects ----------------------------------------------------
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

    select po.user_id into v_new_owner
      from public.properties pr
      join public.portfolios po on po.id = pr.portfolio_id
     where pr.id = new.property_id;

    if old.property_id is distinct from new.property_id then
        select po.user_id into v_old_owner
          from public.properties pr
          join public.portfolios po on po.id = pr.portfolio_id
         where pr.id = old.property_id;

        -- Wie bei Objekten/Einheiten/Mietverträgen (set_owner_user_id): nur innerhalb desselben
        -- Eigentümers. Sonst bliebe die alte user_id stehen und der bisherige Eigentümer behielte
        -- über has_renovation_project_access Zugriff auf Projekt und Unterdaten.
        if v_old_owner is null or v_new_owner is null or v_old_owner <> v_new_owner then
            raise exception 'Sanierungsprojekte können nur zu Objekten desselben Eigentümers verschoben werden.'
                using errcode = '42501';
        end if;
    end if;

    -- user_id geändert: nur der Eigentümer des Objekts. Das eigene Konto eines Mitnutzers nicht,
    -- sonst behielte er über has_renovation_project_access (p.user_id = auth.uid()) nach Entzug
    -- der Freigabe Zugriff auf Projekt und Unterdaten. Eine unveränderte user_id (Altbestand
    -- eines Teammitglieds) kommt hier nicht an.
    if old.user_id is distinct from new.user_id
       and (v_new_owner is null or new.user_id is distinct from v_new_owner) then
        raise exception 'Sanierungsprojekte können nur dem Eigentümer des Objekts zugeordnet werden.'
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
    when (old.property_id is distinct from new.property_id
          or old.user_id is distinct from new.user_id)
    execute function public.renovation_projects_same_owner_on_move();

-- a2) Unterdaten von Projekten und Kalkulationen -------------------------------
create or replace function public.renovation_user_id_guard()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
declare
    v_kind text;
    v_ref uuid;
    v_parent_user uuid;
    v_owner uuid;
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

    -- user_id und Objekt-Eigentümer des übergeordneten Datensatzes. Gelesen wird mit den Rechten
    -- des Bearbeiters: USING hat ihm Schreibrecht darauf bescheinigt, er sieht ihn also. Ist er
    -- nicht lesbar, bleiben beide Werte leer und die Änderung wird abgelehnt.
    if v_kind = 'renovation_project' then
        select rp.user_id, po.user_id into v_parent_user, v_owner
          from public.renovation_projects rp
          left join public.properties pr on pr.id = rp.property_id
          left join public.portfolios po on po.id = pr.portfolio_id
         where rp.id = v_ref;
    else
        select rc.user_id, po.user_id into v_parent_user, v_owner
          from public.renovation_calculations rc
          left join public.properties pr on pr.id = rc.property_id
          left join public.portfolios po on po.id = pr.portfolio_id
         where rc.id = v_ref;
    end if;

    -- Neue user_id: Eigentümer des Objekts oder user_id des Projekts/der Kalkulation. Das eigene
    -- Konto des Bearbeiters nur, wenn es eines von beiden ist; ein fremdes Konto nie.
    if new.user_id is null
       or (new.user_id is distinct from v_owner and new.user_id is distinct from v_parent_user) then
        raise exception 'user_id kann nur auf den Eigentümer der Daten geändert werden.'
            using errcode = '42501';
    end if;
    return new;
end;
$function$;

revoke execute on function public.renovation_user_id_guard()
    from public, anon, authenticated;

-- b) Einheit muss zum Objekt gehören --------------------------------------------
create or replace function public.renovation_unit_matches_property()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
declare
    v_unit_property uuid;
begin
    -- Ohne Objekt oder ohne Einheit nichts zu prüfen (auch ON DELETE SET NULL).
    if new.unit_id is null or new.property_id is null then
        return new;
    end if;

    -- Beim Ändern nur, wenn sich Einheit oder Objekt ändern; Altbestand bleibt bearbeitbar.
    if tg_op = 'UPDATE'
       and new.unit_id is not distinct from old.unit_id
       and new.property_id is not distinct from old.property_id then
        return new;
    end if;

    -- Angemeldete Bearbeiter sehen alle Einheiten des Objekts (units_select); eine nicht lesbare
    -- Einheit gehört also nicht zu diesem Objekt.
    select u.property_id into v_unit_property
      from public.units u
     where u.id = new.unit_id;

    if v_unit_property is distinct from new.property_id then
        raise exception 'Die gewählte Einheit gehört nicht zum gewählten Objekt.'
            using errcode = '23514';
    end if;
    return new;
end;
$function$;

revoke execute on function public.renovation_unit_matches_property()
    from public, anon, authenticated;

drop trigger if exists trg_renovation_projects_unit_property on public.renovation_projects;
create trigger trg_renovation_projects_unit_property
    before insert or update of property_id, unit_id on public.renovation_projects
    for each row
    execute function public.renovation_unit_matches_property();

drop trigger if exists trg_renovation_calculations_unit_property on public.renovation_calculations;
create trigger trg_renovation_calculations_unit_property
    before insert or update of property_id, unit_id on public.renovation_calculations
    for each row
    execute function public.renovation_unit_matches_property();

-- Altbestand nur zählen (nicht ändern, nicht blockieren) -------------------------
do $$
declare
    v_proj_unit int;
    v_calc_unit int;
    v_proj_user int;
begin
    select count(*) into v_proj_unit
      from public.renovation_projects rp
      join public.units u on u.id = rp.unit_id
     where u.property_id <> rp.property_id;
    select count(*) into v_calc_unit
      from public.renovation_calculations rc
      join public.units u on u.id = rc.unit_id
     where rc.property_id is not null and u.property_id <> rc.property_id;
    select count(*) into v_proj_user
      from public.renovation_projects rp
      join public.properties pr on pr.id = rp.property_id
      join public.portfolios po on po.id = pr.portfolio_id
     where rp.user_id <> po.user_id;
    raise notice 'AC_RENO_SELF_ASSIGN Altbestand (bleibt unverändert): Einheit passt nicht zum Objekt – Projekte %, Kalkulationen %; Projekte mit user_id <> Eigentümer %',
        v_proj_unit, v_calc_unit, v_proj_user;
end $$;
