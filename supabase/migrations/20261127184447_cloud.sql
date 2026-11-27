-- =============================================================================
-- Paket CLOUD (Komplett-Check 2026-11-27) – Tabellen cloud_connections, portfolio_cloud_links
--
-- Befunde: E1-08, G05-06, M2-06, D4-03 (Cloud-Teil), M2-17, E1-09 (Policy-Teil),
--          M2-23 (Cloud-Teil: diese Datei ist idempotent)
--
-- 1. cloud_connections
--    - Die OAuth-Tokens (access_token, refresh_token) sind für anon/authenticated nicht mehr
--      lesbar (Spaltenrechte). Der Browser sieht nur id, user_id, provider, account_email,
--      expires_at, created_at – und nur die eigenen Zeilen.
--    - Anlegen und Ändern nur noch serverseitig (Edge Function cloud-auth mit service_role).
--      Löschen der eigenen Verbindung bleibt erlaubt (Rückfallweg in CloudSettings.jsx).
-- 2. portfolio_cloud_links
--    - Nur eigene Zeilen. Anlegen/Ändern nur mit einer EIGENEN Verbindung und nur für Portfolios,
--      auf die der Nutzer Zugriff hat (Kategorie immobilien, lesen genügt – die Zuweisung wirkt
--      nur auf den eigenen Account).
--
-- VORAUSSETZUNGEN / REIHENFOLGE (wichtig):
--   a) Fundament 20261127100000_sec_access_helpers.sql ist eingespielt (has_portfolio_access/3).
--   b) Die NEUEN Versionen der Edge Functions cloud-auth, cloud-drive und cloud-sync sind deployt.
--      Sie lesen/schreiben die Tokens per service_role. Die alten Versionen lesen die Tokens mit
--      dem Nutzer-JWT und würden nach dieser Datei mit "permission denied" scheitern.
--   c) Kein Client-Code lädt cloud_connections mehr mit select('*') – sonst Fehler 42501 in der
--      jeweiligen Ansicht (betrifft Topbar.jsx, Properties.jsx, TenantDetail.jsx; siehe Bericht).
--   sync-applicant-files arbeitet mit service_role und ist nicht betroffen.
--
-- Idempotent: mehrfaches Ausführen ist unschädlich.
-- =============================================================================

-- ------------------------------------------------------------ 1. cloud_connections
alter table public.cloud_connections enable row level security;

-- REVOKE auf Tabellenebene entfernt auch vorhandene Spaltenrechte (daher wiederholbar)
revoke all on table public.cloud_connections from anon;
revoke all on table public.cloud_connections from authenticated;
grant select (id, user_id, provider, account_email, expires_at, created_at)
  on public.cloud_connections to authenticated;
grant delete on public.cloud_connections to authenticated;
grant all on table public.cloud_connections to service_role;

drop policy if exists "Users can view their own cloud connections" on public.cloud_connections;
drop policy if exists "Users can insert their own cloud connections" on public.cloud_connections;
drop policy if exists "Users can update their own cloud connections" on public.cloud_connections;
drop policy if exists "Users can delete their own cloud connections" on public.cloud_connections;
drop policy if exists cloud_connections_select_own on public.cloud_connections;
drop policy if exists cloud_connections_delete_own on public.cloud_connections;

create policy cloud_connections_select_own on public.cloud_connections
  for select to authenticated
  using (user_id = auth.uid());

create policy cloud_connections_delete_own on public.cloud_connections
  for delete to authenticated
  using (user_id = auth.uid());

-- Keine INSERT-/UPDATE-Policy: Schreiben nur per service_role (umgeht RLS).

comment on column public.cloud_connections.access_token is
  'OAuth-Access-Token. Nur für service_role lesbar (Edge Functions), nie an den Browser ausliefern.';
comment on column public.cloud_connections.refresh_token is
  'OAuth-Refresh-Token. Nur für service_role lesbar (Edge Functions), nie an den Browser ausliefern.';

-- ------------------------------------------------------- 2. portfolio_cloud_links
alter table public.portfolio_cloud_links enable row level security;

revoke all on table public.portfolio_cloud_links from anon;
revoke truncate, references, trigger on table public.portfolio_cloud_links from authenticated;
grant select, insert, update, delete on table public.portfolio_cloud_links to authenticated;
grant all on table public.portfolio_cloud_links to service_role;

drop policy if exists "Users can view their own portfolio cloud links" on public.portfolio_cloud_links;
drop policy if exists "Users can insert their own portfolio cloud links" on public.portfolio_cloud_links;
drop policy if exists "Users can update their own portfolio cloud links" on public.portfolio_cloud_links;
drop policy if exists "Users can delete their own portfolio cloud links" on public.portfolio_cloud_links;
drop policy if exists portfolio_cloud_links_select_own on public.portfolio_cloud_links;
drop policy if exists portfolio_cloud_links_insert_own on public.portfolio_cloud_links;
drop policy if exists portfolio_cloud_links_update_own on public.portfolio_cloud_links;
drop policy if exists portfolio_cloud_links_delete_own on public.portfolio_cloud_links;

create policy portfolio_cloud_links_select_own on public.portfolio_cloud_links
  for select to authenticated
  using (user_id = auth.uid());

create policy portfolio_cloud_links_insert_own on public.portfolio_cloud_links
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.cloud_connections c
      where c.id = portfolio_cloud_links.cloud_connection_id
        and c.user_id = auth.uid()
    )
    and public.has_portfolio_access(portfolio_id, 'immobilien', 'read')
  );

create policy portfolio_cloud_links_update_own on public.portfolio_cloud_links
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.cloud_connections c
      where c.id = portfolio_cloud_links.cloud_connection_id
        and c.user_id = auth.uid()
    )
    and public.has_portfolio_access(portfolio_id, 'immobilien', 'read')
  );

create policy portfolio_cloud_links_delete_own on public.portfolio_cloud_links
  for delete to authenticated
  using (user_id = auth.uid());
