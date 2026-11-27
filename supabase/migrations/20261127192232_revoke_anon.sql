-- =============================================================================
-- Ausführungs- und Tabellenrechte für nicht angemeldete Besucher (anon) einschränken
-- Komplett-Check 2026-11-27, Phase 1 / Schritt 6 (5.1: 74 SECURITY-DEFINER-Funktionen
-- und alle 74 Tabellen/Sichten waren für anon freigegeben).
--
-- Läuft als LETZTE Sicherheits-Migration, nachdem alle Policies umgestellt sind.
-- Funktionen: anon behält EXECUTE nur für
--   * die Token-Funktionen der öffentlichen Seiten (Whitelist unten) und
--   * Funktionen, die in Policies verwendet werden, die für anon/public gelten
--     (sonst würden öffentliche Abfragen mit "permission denied" abbrechen).
-- Tabellen/Sichten: anon verliert alle Rechte auf Objekte, für die keine Policy
-- an anon/public gerichtet ist.
-- authenticated und service_role behalten bzw. erhalten EXECUTE ausdrücklich.
-- Trigger-Funktionen feuern unabhängig vom EXECUTE-Recht des Aufrufers.
-- =============================================================================

do $$
declare
  f record;
  t record;
  keep text[] := array[
    'get_public_claim_by_token',
    'submit_public_payment_plan_request',
    'get_tenant_by_token',
    'update_tenant_by_token',
    'get_rental_process_by_token',
    'submit_rental_application',
    'get_rental_viewing_schedule',
    'get_rental_applicant_for_booking',
    'book_viewing',
    'cancel_viewing_booking',
    'applicant_document_upload_allowed'
  ];
  pol_funcs text[];
begin
  select coalesce(array_agg(distinct pr.proname), '{}')
    into pol_funcs
  from pg_policies pol
  join pg_proc pr on true
  join pg_namespace n on n.oid = pr.pronamespace and n.nspname = 'public'
  where pol.roles && array['public', 'anon']::name[]
    and (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ~ ('\m' || pr.proname || '\s*\(');

  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    if f.proname = any(keep) or f.proname = any(pol_funcs) then
      execute format('grant execute on function %s to anon, authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from anon, public', f.sig);
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    end if;
  end loop;

  for t in
    select c.oid::regclass as rel, c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  loop
    if t.relkind = 'r' or t.relkind = 'p' then
      if not exists (
        select 1 from pg_policies pol
        where pol.schemaname = 'public' and pol.tablename = t.relname
          and pol.roles && array['public', 'anon']::name[]
      ) then
        execute format('revoke all on table %s from anon', t.rel);
      end if;
    else
      -- Sichten: anon braucht keine (öffentliche Seiten nutzen Token-Funktionen)
      execute format('revoke all on table %s from anon', t.rel);
    end if;
  end loop;
end $$;

-- Künftig angelegte Funktionen nicht mehr automatisch für anon ausführbar.
-- ACHTUNG: Für PUBLIC wirkt das schema-bezogene REVOKE nicht (Schema-Vorgaben ergänzen die
-- globale PostgreSQL-Vorgabe „PUBLIC darf ausführen" nur, sie können sie nicht entziehen).
-- Neue Funktionen sind daher weiterhin über PUBLIC ausführbar – jede neue SECURITY-DEFINER-
-- Funktion muss selbst „revoke execute on function … from public, anon" enthalten.
alter default privileges in schema public revoke execute on functions from anon, public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;
