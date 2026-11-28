-- =============================================================================
-- Welle 4 · Paket G_DB · 01 Leistung (RLS/Indizes) und saubere Funktionsrechte
-- Befunde: Supabase-Advisor auth_rls_initplan (59 Policies in public) und unindexed_foreign_keys (4),
--          D3b-20 (auth.uid() in Policies als (select auth.uid()) kapseln),
--          D2-20 (EXECUTE-Rechte: Token-RPCs ausdrücklich, globale Vorgabe ohne PUBLIC),
--          Folgearbeit aus Welle 3 / 10_STRIPE (Aufbewahrung von stripe_webhook_events).
--
-- Idempotent (zweiter Lauf ändert nichts). Keine Änderung an der Logik der Policies, an Rollen,
-- Kommandos oder permissive/restrictive. Signaturen, SECURITY-Art und Rechte bestehender Funktionen
-- bleiben unverändert (außer dem entfernten PUBLIC-Recht der Token-Funktionen, Abschnitt 3).
-- notify_push wird nicht berührt.
-- Hinweis Reihenfolge: Abschnitt 1 erfasst alle Policies, die beim Einspielen existieren. Legen später
-- eingespielte Migrationen neue Policies mit ungekapseltem auth.uid() an, diese Datei einfach erneut
-- einspielen (oder sie als letzte Datei der Welle einspielen).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. auth_rls_initplan: auth.uid()/auth.jwt()/auth.role()/auth.email() in Policies einmal je Abfrage
--    statt je Zeile auswerten – gleiche Logik, nur „(select auth.uid())" statt „auth.uid()".
--    Bereits gekapselte Aufrufe (Darstellung „( SELECT auth.uid() AS uid)") bleiben unberührt.
--    Gelesen und geschrieben wird mit demselben search_path (Texte aus pg_policies sind darauf bezogen).
--    Stand 28.11.2026: 59 Policies auf 24 Tabellen, alle permissive, Rolle authenticated.
--    Die alten/neuen Texte landen transaktionslokal in immo.w4_policy_rewrite (nur für den Test in
--    derselben Transaktion; verfällt mit dem Transaktionsende).
-- -----------------------------------------------------------------------------
do $$
declare
    r record;
    v_re constant text := '(?<!SELECT )auth\.(uid|jwt|role|email)\(\)';
    v_qual text;
    v_check text;
    v_log jsonb := '[]'::jsonb;
begin
    for r in
        select p.tablename, p.policyname, p.cmd, p.permissive, p.roles::text as roles, p.qual, p.with_check
          from pg_policies p
         where p.schemaname = 'public'
           and (coalesce(p.qual, '') ~ v_re or coalesce(p.with_check, '') ~ v_re)
         order by p.tablename, p.policyname
    loop
        v_qual := case when coalesce(r.qual, '') ~ v_re
                       then regexp_replace(r.qual, v_re, '(select auth.\1())', 'g') end;
        v_check := case when coalesce(r.with_check, '') ~ v_re
                        then regexp_replace(r.with_check, v_re, '(select auth.\1())', 'g') end;

        -- nur die betroffenen Klauseln neu setzen (ALTER POLICY lässt Rollen/Kommando/Art unverändert)
        execute format('alter policy %I on public.%I', r.policyname, r.tablename)
             || coalesce(' using (' || v_qual || ')', '')
             || coalesce(' with check (' || v_check || ')', '');

        v_log := v_log || jsonb_build_object(
            't', r.tablename, 'p', r.policyname, 'cmd', r.cmd, 'permissive', r.permissive, 'roles', r.roles,
            'q_old', case when v_qual is not null then r.qual end, 'q_new', v_qual,
            'c_old', case when v_check is not null then r.with_check end, 'c_new', v_check);
    end loop;

    perform set_config('immo.w4_policy_rewrite', v_log::text, true);
    raise notice 'auth_rls_initplan: % Policies umgestellt', jsonb_array_length(v_log);
end $$;


-- -----------------------------------------------------------------------------
-- 2. unindexed_foreign_keys: Indizes für Fremdschlüssel auf auth.users (Löschen eines Kontos prüft
--    diese Spalten). Benennung wie die bestehenden idx_fk_<tabelle>_<spalte>.
-- -----------------------------------------------------------------------------
create index if not exists idx_fk_lease_notes_updated_by on public.lease_notes (updated_by);
create index if not exists idx_fk_renovation_invoices_created_by on public.renovation_invoices (created_by);
create index if not exists idx_fk_renovation_projects_created_by on public.renovation_projects (created_by);
create index if not exists idx_fk_renovation_tasks_created_by on public.renovation_tasks (created_by);


-- -----------------------------------------------------------------------------
-- 3. Die 11 öffentlichen Token-Funktionen (einzige Funktionen in public, die anon ausführen darf):
--    Recht ausdrücklich an anon/authenticated/service_role statt über PUBLIC. Wirkung unverändert
--    (anon/authenticated/service_role hatten das Recht schon ausdrücklich). Signaturen live geprüft
--    am 28.11.2026 (je Name genau eine Funktion). update_tenant_by_token hatte PUBLIC schon nicht mehr.
--    Kein anderes Funktionsrecht wird geändert.
-- -----------------------------------------------------------------------------
revoke execute on function public.applicant_document_upload_allowed(text) from public;
grant execute on function public.applicant_document_upload_allowed(text) to anon, authenticated, service_role;

revoke execute on function public.get_public_claim_by_token(text, text) from public;
grant execute on function public.get_public_claim_by_token(text, text) to anon, authenticated, service_role;

revoke execute on function public.submit_public_payment_plan_request(text, text, integer, numeric, numeric, numeric, text) from public;
grant execute on function public.submit_public_payment_plan_request(text, text, integer, numeric, numeric, numeric, text) to anon, authenticated, service_role;

revoke execute on function public.get_tenant_by_token(text) from public;
grant execute on function public.get_tenant_by_token(text) to anon, authenticated, service_role;

revoke execute on function public.update_tenant_by_token(text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.update_tenant_by_token(text, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;

revoke execute on function public.get_rental_process_by_token(text) from public;
grant execute on function public.get_rental_process_by_token(text) to anon, authenticated, service_role;

revoke execute on function public.submit_rental_application(text, jsonb) from public;
grant execute on function public.submit_rental_application(text, jsonb) to anon, authenticated, service_role;

revoke execute on function public.get_rental_viewing_schedule(text) from public;
grant execute on function public.get_rental_viewing_schedule(text) to anon, authenticated, service_role;

revoke execute on function public.get_rental_applicant_for_booking(text, uuid) from public;
grant execute on function public.get_rental_applicant_for_booking(text, uuid) to anon, authenticated, service_role;

revoke execute on function public.book_viewing(text, uuid, uuid, time without time zone) from public;
grant execute on function public.book_viewing(text, uuid, uuid, time without time zone) to anon, authenticated, service_role;

revoke execute on function public.cancel_viewing_booking(text, uuid, uuid) from public;
grant execute on function public.cancel_viewing_booking(text, uuid, uuid) to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4. Globale Vorgabe: neue Funktionen von postgres bekommen kein PUBLIC-EXECUTE mehr.
--    (Ein „… in schema public revoke … from public" wirkt nicht – Schema-Vorgaben ergänzen nur die
--    globale Vorgabe. Deshalb hier OHNE „in schema".)
--    pg_default_acl am 28.11.2026 (lesend geprüft):
--      - postgres, global, Funktionen: kein Eintrag = eingebaute Vorgabe „PUBLIC + Eigentümer".
--        Nach dieser Anweisung: {postgres=X/postgres}.
--      - postgres, Schema public, Funktionen: {postgres=X, authenticated=X, service_role=X}
--        – gilt unverändert weiter; anon ist dort bereits entfernt (Migration revoke_anon, 27.11.2026).
--        Neue Funktionen von postgres in public: postgres + authenticated + service_role, kein PUBLIC,
--        kein anon. Neue Token-Funktionen für nicht angemeldete Besucher brauchen künftig ein
--        ausdrückliches „grant execute … to anon".
--      - postgres, Schema storage, Funktionen: {postgres, anon, authenticated, service_role} – unverändert.
--      - Vorgaben von supabase_admin (public, graphql, …) gelten nur für dessen Objekte – unberührt.
--    Achtung: Funktionen, die postgres künftig in anderen Schemas ohne Schema-Vorgabe anlegt
--    (z. B. extensions), sind danach nur noch für postgres ausführbar → dort ausdrücklich granten.
-- -----------------------------------------------------------------------------
alter default privileges for role postgres revoke execute on functions from public;


-- -----------------------------------------------------------------------------
-- 5. stripe_webhook_events: Aufbewahrung. Erledigte Einträge (status 'processed') älter als 180 Tage
--    werden beim Abschließen eines Ereignisses gelöscht – je Aufruf höchstens 200 Zeilen
--    (Teilmenge über ctid, Index status/received_at), gesperrte Zeilen werden übersprungen.
--    Das Aufräumen darf das Abschließen nie verhindern (eigener Block mit Fehlerfang).
--    Signatur, SECURITY INVOKER, search_path, Rechte (postgres, service_role) und Kommentar bleiben;
--    stripe_webhook_event_begin bleibt unverändert. Fehlgeschlagene/laufende Einträge bleiben stehen.
-- -----------------------------------------------------------------------------
create or replace function public.stripe_webhook_event_finish(p_event_id text, p_success boolean, p_outcome text default null::text, p_error text default null::text)
 returns void
 language plpgsql
 set search_path = public, pg_temp
as $function$
begin
  update public.stripe_webhook_events
     set status = case when coalesce(p_success, false) then 'processed' else 'failed' end,
         processed_at = case when coalesce(p_success, false) then clock_timestamp() end,
         outcome = case when p_outcome ~ '^[a-z_]{1,100}$' then p_outcome end,
         last_error = case
                        when coalesce(p_success, false) then null
                        else left(coalesce(nullif(btrim(p_error), ''), 'Unbekannter Fehler'), 500)
                      end
   where event_id = p_event_id;

  -- Aufbewahrung: erledigte Einträge nach 180 Tagen löschen (höchstens 200 je Aufruf)
  begin
    delete from public.stripe_webhook_events
     where ctid = any (array(
             select e.ctid
               from public.stripe_webhook_events e
              where e.status = 'processed'
                and e.received_at < now() - interval '180 days'
              order by e.received_at
              limit 200
                for update skip locked));
  exception when others then
    raise warning 'stripe_webhook_events: Aufräumen übersprungen (%)', sqlerrm;
  end;
end;
$function$;
