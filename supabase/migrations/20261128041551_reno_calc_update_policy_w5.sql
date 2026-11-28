-- =============================================================================
-- Welle 5 – Paket S_RENO_POLICY
-- renovation_calculations: Objekt entfernen/wechseln durch Mitnutzer, user_id beim Ändern
--
-- Befund (Welle 4, E_PROPS_IMPORT, offener Punkt): Ein Mitnutzer mit Schreibrecht
-- (portfolio_shares, immobilien/investorportal = write) kann bei einer Kalkulation des
-- Eigentümers das Objekt nicht entfernen (property_id -> NULL). Ebenso der Eigentümer bei
-- einer Kalkulation, die noch am Konto eines Teammitglieds hängt.
--
-- Ursache (Live-Stand, zwei Stufen):
--   1. WITH CHECK der Update-Policy: Zweig "property_id IS NULL" verlangt
--      user_id = auth.uid(). Die App ändert user_id beim Speichern nicht -> user_id bleibt
--      der Eigentümer -> 42501.
--   2. Selbst mit gelockertem WITH CHECK scheitert es: PostgREST filtert per WHERE id = …
--      (und .select('id') = RETURNING). Dann muss die NEUE Zeile auch die SELECT-Policy
--      erfüllen. Eine Kalkulation ohne Objekt sieht nur ihr user_id-Konto -> für den
--      Mitnutzer unsichtbar -> 42501 (live im Test nachgewiesen).
--   => Ohne Ausweitung der Leserechte geht das Entfernen nur, wenn die Kalkulation dabei
--      in das Konto des Bearbeiters wandert. Das erlaubt die Policy schon heute (user_id =
--      auth.uid()), die App sendet es aber nicht. Es ist keine neue Befugnis: Wer
--      Schreibrecht hat, darf die Kalkulation löschen und sie (Leserecht) kopieren.
--
-- Ähnliche Lücke (gleiche Policy): Im Zweig "mit Objekt" prüft WITH CHECK die user_id gar
-- nicht. Ein Bearbeiter mit Schreibrecht kann die Kalkulation einem beliebigen fremden Konto
-- zuordnen, das sie dann liest (SELECT über user_id). Und beim Verschieben auf ein Objekt
-- eines anderen Eigentümers bleibt die alte user_id stehen: Der alte Eigentümer liest dann
-- weiter mit, was das Team des neuen Eigentümers dort ändert. Beim Anlegen verhindert das
-- rls_user_ok(user_id, 'property', property_id).
--
-- Korrektur:
--   a) Update-Policy WITH CHECK, Zweig mit Objekt, zusätzlich:
--        rls_user_ok(user_id, 'property', property_id)               -- eigenes Konto oder Portfolio-Eigentümer (wie Insert)
--     or rls_user_ok(user_id, 'renovation_calculation', id)           -- oder die bisherige user_id (bzw. Eigentümer des
--                                                                     --  bisherigen Objekts; gelesen wird die gespeicherte Zeile)
--      Zweig ohne Objekt, USING, Insert, Select, Delete: unverändert.
--   b) BEFORE-UPDATE-Trigger, nur bei Objektwechsel und nur für direkte Änderungen
--      angemeldeter Nutzer (current_user = authenticated; ON DELETE SET NULL beim Löschen
--      eines Objekts läuft als Tabelleneigentümer und bleibt unberührt):
--        - Objekt entfernt          -> user_id := auth.uid() (Bearbeiter übernimmt)
--        - Objekt gewechselt, user_id passt nicht zum neuen Objekt
--                                   -> user_id := Eigentümer des neuen Portfolios
--      Die Zugriffsprüfung bleibt vollständig bei RLS (USING lässt nur Bearbeiter mit
--      Schreibrecht an die Zeile; Leserecht und fremde Konten erreichen den Trigger nicht).
--
-- Idempotent (drop … if exists / create or replace). Trigger-Funktion SECURITY INVOKER,
-- kein EXECUTE für public/anon/authenticated (Trigger brauchen es nicht).
-- Rollback: rollback/11_reno_calc_update_policy.rollback.sql
-- =============================================================================

-- a) Update-Policy -----------------------------------------------------------
drop policy if exists renovation_calculations_update on public.renovation_calculations;
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
            else (public.has_property_access(property_id, 'immobilien', 'write')
                  or public.has_property_access(property_id, 'investorportal', 'write'))
                 and (public.rls_user_ok(user_id, 'property', property_id)
                      or public.rls_user_ok(user_id, 'renovation_calculation', id))
        end
        and (unit_id is null
             or public.has_unit_access(unit_id, 'immobilien', 'write')
             or public.has_unit_access(unit_id, 'investorportal', 'write'))
    );

-- b) user_id folgt dem Objekt -------------------------------------------------
create or replace function public.renovation_calculations_owner_follows_property()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
declare
    v_uid uuid := auth.uid();
    v_owner uuid;
begin
    -- Nur direkte Änderungen angemeldeter Nutzer. ON DELETE SET NULL beim Löschen eines
    -- Objekts (läuft als Tabelleneigentümer), RPCs (SECURITY DEFINER) und Server-Zugriffe
    -- lassen user_id unverändert.
    if current_user <> 'authenticated' or v_uid is null then
        return new;
    end if;

    if new.property_id is null then
        -- Objekt entfernt: Eine Kalkulation ohne Objekt sieht nur ihr user_id-Konto. Sie geht
        -- an den Bearbeiter, sonst wäre sie für ihn unsichtbar und das Speichern scheitert.
        new.user_id := v_uid;
    elsif not public.rls_user_ok(new.user_id, 'property', new.property_id) then
        -- Objekt gewechselt: user_id muss wie beim Anlegen zum Objekt passen (eigenes Konto
        -- oder Portfolio-Eigentümer), sonst liest der bisherige Eigentümer weiter mit.
        select po.user_id into v_owner
          from public.properties pr
          join public.portfolios po on po.id = pr.portfolio_id
         where pr.id = new.property_id;
        if v_owner is not null then
            new.user_id := v_owner;
        end if;
    end if;

    return new;
end;
$function$;

revoke execute on function public.renovation_calculations_owner_follows_property()
    from public, anon, authenticated;

drop trigger if exists trg_renovation_calculations_owner on public.renovation_calculations;
create trigger trg_renovation_calculations_owner
    before update on public.renovation_calculations
    for each row
    when (old.property_id is distinct from new.property_id)
    execute function public.renovation_calculations_owner_follows_property();
