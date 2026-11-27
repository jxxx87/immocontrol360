-- =============================================================================
-- 109100_sec_followup.sql · Nachhärtung nach den Sicherheits-Migrationen (Komplett-Check 2026-11-27)
-- Grundlage: Supabase-Security-Advisor nach 109000_revoke_anon.
--
-- 1. function_search_path_mutable (11): alte Ein-Parameter-Fassungen has_*_access(uuid)
--    (SECURITY DEFINER, aus der Zeit vor sec_access_helpers) bekommen einen festen search_path.
--    notify_push bleibt bewusst unberührt (Phase 0: enthält den alten Schlüssel, Nutzer).
-- 2. pg_graphql_anon_table_exposed (10): Tabellen mit älteren Policies für die Rolle public
--    (Mieterportal) behielten in 109000 das Leserecht für anon. anon braucht sie nicht –
--    alle öffentlichen Seiten arbeiten über Token-Funktionen (SECURITY DEFINER).
-- 3. Trigger-Funktionen (returns trigger) sind nicht direkt aufrufbar zu halten: kein EXECUTE
--    für anon/authenticated/PUBLIC. PostgreSQL prüft EXECUTE nur beim Anlegen eines Triggers,
--    nicht beim Feuern – bestehende Trigger laufen unverändert weiter.
-- Idempotent.
-- =============================================================================

-- 1. fester search_path für die alten Hilfsfunktionen
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname in ('has_claim_access', 'has_economic_unit_access', 'has_invoice_access',
                         'has_lease_access', 'has_portfolio_access', 'has_property_access',
                         'has_renovation_calc_trade_access', 'has_renovation_calculation_access',
                         'has_renovation_project_access', 'has_renovation_project_trade_access',
                         'has_unit_access')
       and (p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;

-- 2. kein Tabellenzugriff für anon
revoke all on table public.announcements from anon;
revoke all on table public.documents from anon;
revoke all on table public.leases from anon;
revoke all on table public.objektkalender_events from anon;
revoke all on table public.objektkalender_history from anon;
revoke all on table public.objektkalender_settings from anon;
revoke all on table public.portfolios from anon;
revoke all on table public.properties from anon;
revoke all on table public.tenants from anon;
revoke all on table public.units from anon;

-- 3. Trigger-Funktionen nicht direkt ausführbar
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
