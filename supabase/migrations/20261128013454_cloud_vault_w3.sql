-- =============================================================================
-- Wave 3 – Paket 08 CLOUD (2026-11-27)
--
-- Befunde:
--   M2-06        OAuth-Tokens der Cloud-Anbindung liegen im Klartext in cloud_connections
--                -> Tokens zusätzlich verschlüsselt im Supabase Vault (Übergangsbetrieb, s. u.)
--   CLOUD-unique Kein Unique-Index auf (user_id, provider, account_email)
--   G18-12       Cloud-Ordner eines Mietverhältnisses hängt nur am Namen -> neue Tabelle
--                lease_cloud_folders merkt sich den Ordner je Mietverhältnis und Verbindung
--
-- 1. cloud_connections.access_token_secret_id / refresh_token_secret_id (uuid, Verweis auf vault.secrets)
-- 2. cloud_get_tokens(p_connection_id, p_user_id)          -> (access_token, refresh_token)
--    cloud_store_tokens(p_connection_id, p_user_id, p_access_token, p_refresh_token, p_expires_at)
--    beide SECURITY DEFINER, ausführbar NUR für service_role (Edge Functions).
--    Hilfsfunktionen cloud_vault_put, cloud_tokens_keep_plaintext: für niemanden außer dem Eigentümer.
-- 3. Trigger: beim Löschen einer Verbindung werden ihre Vault-Einträge mitgelöscht.
-- 4. Unique-Index cloud_connections (user_id, provider, account_email) – NULL-E-Mails bleiben mehrfach erlaubt.
-- 5. Tabelle lease_cloud_folders (RLS, nur eigene Zeilen).
--
-- ÜBERGANGSBETRIEB (wichtig):
--   Diese Datei ist mit den HEUTE deployten Edge Functions verträglich: Die Klartext-Spalten bleiben
--   unverändert, cloud_store_tokens schreibt solange Vault UND Klartext (cloud_tokens_keep_plaintext()
--   = true), und cloud_get_tokens bevorzugt den Klartext, falls eine alte Function-Version ihn
--   zwischendurch neuer geschrieben hat.
--   Erst wenn ALLE vier Functions (cloud-auth, cloud-drive, cloud-sync, sync-applicant-files) in der
--   neuen Fassung deployt sind, wird _fixwork/sql/wave3/deferred/08b_cloud_tokens_finalize.sql
--   eingespielt: nur noch Vault, Klartext-Spalten werden geleert.
--
-- Voraussetzungen: Erweiterung supabase_vault (live 0.3.1), Fundament has_lease_access(uuid,text,text),
--                  20261127184447_cloud.sql (Spaltenrechte auf cloud_connections).
-- Idempotent: mehrfaches Ausführen ist unschädlich.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'Erweiterung supabase_vault fehlt – Migration 08_cloud abgebrochen';
  end if;
  if to_regprocedure('public.has_lease_access(uuid,text,text)') is null then
    raise exception 'Fundament has_lease_access(uuid,text,text) fehlt – Migration 08_cloud abgebrochen';
  end if;
end $$;

-- ------------------------------------------------------------------ 1. Spalten
alter table public.cloud_connections add column if not exists access_token_secret_id uuid;
alter table public.cloud_connections add column if not exists refresh_token_secret_id uuid;

comment on column public.cloud_connections.access_token_secret_id is
  'Verweis auf vault.secrets (verschlüsseltes Access-Token). Lesen/Schreiben nur über cloud_get_tokens/cloud_store_tokens (service_role).';
comment on column public.cloud_connections.refresh_token_secret_id is
  'Verweis auf vault.secrets (verschlüsseltes Refresh-Token). Lesen/Schreiben nur über cloud_get_tokens/cloud_store_tokens (service_role).';
comment on column public.cloud_connections.access_token is
  'Veraltet: Klartext nur im Übergangsbetrieb (bis 08b_cloud_tokens_finalize). Maßgeblich ist der Vault.';
comment on column public.cloud_connections.refresh_token is
  'Veraltet: Klartext nur im Übergangsbetrieb (bis 08b_cloud_tokens_finalize). Maßgeblich ist der Vault.';

-- Der Browser sieht weiterhin nur die sechs Anzeige-Spalten (Spaltenrechte aus 20261127184447_cloud.sql).
-- Für die neuen Spalten gibt es bewusst keinen Grant an anon/authenticated.
revoke select (access_token_secret_id, refresh_token_secret_id) on public.cloud_connections from anon, authenticated;

-- ----------------------------------------------------- 2a. Übergangsschalter
-- true  = cloud_store_tokens schreibt zusätzlich die Klartext-Spalten (alte Function-Versionen lesen sie)
-- false = nur Vault (wird von 08b_cloud_tokens_finalize.sql gesetzt)
-- Nur anlegen, wenn noch nicht vorhanden: Ein erneuter Lauf dieser Datei nach 08b darf den Schalter
-- nicht wieder auf Klartext zurückstellen (Prüfung Wave 3).
do $do$
begin
  if to_regprocedure('public.cloud_tokens_keep_plaintext()') is null then
    execute $f$
      create function public.cloud_tokens_keep_plaintext()
      returns boolean
      language sql
      stable
      set search_path = public, pg_temp
      as $b$ select true $b$
    $f$;
  end if;
end $do$;

revoke execute on function public.cloud_tokens_keep_plaintext() from public, anon, authenticated, service_role;

-- --------------------------------------------- 2b. Vault-Eintrag anlegen/ändern
-- Wird nur aus cloud_store_tokens (SECURITY DEFINER, Eigentümer) aufgerufen.
-- p_value leer -> vorhandener Eintrag bleibt unverändert.
create or replace function public.cloud_vault_put(p_secret_id uuid, p_value text, p_name text)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_value is null or p_value = '' then
    return p_secret_id;
  end if;

  if p_secret_id is not null and exists (select 1 from vault.secrets s where s.id = p_secret_id) then
    perform vault.update_secret(p_secret_id, p_value);
    return p_secret_id;
  end if;

  -- Eintrag gleichen Namens (z. B. aus einem abgebrochenen Lauf) wiederverwenden
  select s.id into v_id from vault.secrets s where s.name = p_name;
  if v_id is not null then
    perform vault.update_secret(v_id, p_value);
    return v_id;
  end if;

  return vault.create_secret(p_value, p_name, 'ImmoControl360: OAuth-Token einer Cloud-Verbindung');
end;
$$;

revoke execute on function public.cloud_vault_put(uuid, text, text) from public, anon, authenticated, service_role;

-- -------------------------------------------------------- 2c. Tokens speichern
-- p_access_token / p_refresh_token NULL oder leer = unverändert lassen (beim Umzug aus dem Klartext
-- wird dann der bisherige Klartext-Wert in den Vault übernommen). p_expires_at NULL = unverändert.
create or replace function public.cloud_store_tokens(
  p_connection_id uuid,
  p_user_id uuid,
  p_access_token text,
  p_refresh_token text default null,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.cloud_connections%rowtype;
  v_access text;
  v_refresh text;
  v_access_id uuid;
  v_refresh_id uuid;
  v_keep boolean := public.cloud_tokens_keep_plaintext();
begin
  if p_connection_id is null or p_user_id is null then
    raise exception 'Verbindung und Nutzer sind erforderlich' using errcode = '22004';
  end if;

  select * into r
    from public.cloud_connections c
   where c.id = p_connection_id and c.user_id = p_user_id
   for update;
  if not found then
    raise exception 'Cloud-Verbindung nicht gefunden' using errcode = 'P0002';
  end if;

  v_access := coalesce(nullif(p_access_token, ''), r.access_token);
  v_refresh := coalesce(nullif(p_refresh_token, ''), r.refresh_token);

  v_access_id := public.cloud_vault_put(r.access_token_secret_id, v_access, format('cloud_connection:%s:access_token', r.id));
  v_refresh_id := public.cloud_vault_put(r.refresh_token_secret_id, v_refresh, format('cloud_connection:%s:refresh_token', r.id));

  update public.cloud_connections c
     set access_token_secret_id = v_access_id,
         refresh_token_secret_id = v_refresh_id,
         access_token = case when v_keep then v_access else null end,
         refresh_token = case when v_keep then v_refresh else null end,
         expires_at = coalesce(p_expires_at, c.expires_at)
   where c.id = r.id;
end;
$$;

revoke execute on function public.cloud_store_tokens(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.cloud_store_tokens(uuid, uuid, text, text, timestamptz) to service_role;

-- ----------------------------------------------------------- 2d. Tokens lesen
-- Klartext hat Vorrang, solange vorhanden: Im Übergangsbetrieb ist er gleich oder neuer
-- (eine alte Function-Version hat ihn geschrieben). Nach 08b ist er leer -> Vault.
create or replace function public.cloud_get_tokens(p_connection_id uuid, p_user_id uuid)
returns table (access_token text, refresh_token text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(c.access_token, sa.decrypted_secret) as access_token,
         coalesce(c.refresh_token, sr.decrypted_secret) as refresh_token
    from public.cloud_connections c
    left join vault.decrypted_secrets sa on sa.id = c.access_token_secret_id
    left join vault.decrypted_secrets sr on sr.id = c.refresh_token_secret_id
   where c.id = p_connection_id
     and c.user_id = p_user_id;
$$;

revoke execute on function public.cloud_get_tokens(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cloud_get_tokens(uuid, uuid) to service_role;

-- ------------------------------------------- 3. Vault-Einträge beim Löschen entfernen
-- Greift auch beim Löschen durch den Nutzer selbst (CloudSettings) und bei Kaskaden (Konto gelöscht).
create or replace function public.cloud_connections_delete_secrets()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.access_token_secret_id is not null or old.refresh_token_secret_id is not null then
    delete from vault.secrets s
     where s.id in (old.access_token_secret_id, old.refresh_token_secret_id);
  end if;
  return old;
end;
$$;

revoke execute on function public.cloud_connections_delete_secrets() from public, anon, authenticated, service_role;

drop trigger if exists cloud_connections_delete_secrets on public.cloud_connections;
create trigger cloud_connections_delete_secrets
  after delete on public.cloud_connections
  for each row execute function public.cloud_connections_delete_secrets();

-- ------------------------------------------------------------ 4. Unique-Index
-- Gleiches Konto desselben Anbieters nur einmal je Nutzer (cloud-auth aktualisiert die vorhandene Zeile).
-- Mehrere Zeilen ohne account_email bleiben erlaubt (NULL ist nicht gleich NULL).
do $$
begin
  if exists (
    select 1
      from public.cloud_connections
     where account_email is not null
     group by user_id, provider, account_email
    having count(*) > 1
  ) then
    raise exception 'cloud_connections enthält doppelte Verbindungen (user_id, provider, account_email) – bitte zuerst bereinigen';
  end if;
end $$;

create unique index if not exists cloud_connections_user_provider_email_key
  on public.cloud_connections (user_id, provider, account_email);

-- ---------------------------------------------- 5. Cloud-Ordner je Mietverhältnis
-- Wird von cloud-sync (service_role) beim Anlegen/Prüfen und von der Mieterakte (TenantDetail.jsx)
-- beim ersten erfolgreichen Öffnen geschrieben, von cloud-drive beim Umbenennen von Ordnern
-- nachgeführt. Pfad relativ zum App-Ordner "ImmoControlpro360", Segmente mit '/' getrennt.
create table if not exists public.lease_cloud_folders (
  lease_id uuid not null references public.leases(id) on delete cascade,
  cloud_connection_id uuid not null references public.cloud_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lease_cloud_folders_pkey primary key (lease_id, cloud_connection_id),
  constraint lease_cloud_folders_path_check check (
    char_length(folder_path) between 1 and 2000
    and folder_path !~ '^/'
    and folder_path !~ '/$'
    and folder_path !~ '//'
    and folder_path !~ '(^|/)\.{1,2}(/|$)'
    and folder_path !~ '[[:cntrl:]]'
  )
);

comment on table public.lease_cloud_folders is
  'Cloud-Ordner (Pfad unterhalb ImmoControlpro360) je Mietverhältnis und Cloud-Verbindung – bleibt nach Umbenennungen gültig.';

create index if not exists idx_fk_lease_cloud_folders_cloud_connection_id
  on public.lease_cloud_folders (cloud_connection_id);
create index if not exists idx_lease_cloud_folders_user_id
  on public.lease_cloud_folders (user_id);

alter table public.lease_cloud_folders enable row level security;

revoke all on table public.lease_cloud_folders from public;
revoke all on table public.lease_cloud_folders from anon;
revoke all on table public.lease_cloud_folders from authenticated;
grant select, insert, update, delete on table public.lease_cloud_folders to authenticated;
grant all on table public.lease_cloud_folders to service_role;

drop policy if exists lease_cloud_folders_select_own on public.lease_cloud_folders;
drop policy if exists lease_cloud_folders_insert_own on public.lease_cloud_folders;
drop policy if exists lease_cloud_folders_update_own on public.lease_cloud_folders;
drop policy if exists lease_cloud_folders_delete_own on public.lease_cloud_folders;

create policy lease_cloud_folders_select_own on public.lease_cloud_folders
  for select to authenticated
  using (user_id = auth.uid());

create policy lease_cloud_folders_insert_own on public.lease_cloud_folders
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.cloud_connections c
       where c.id = lease_cloud_folders.cloud_connection_id
         and c.user_id = auth.uid()
    )
    and public.has_lease_access(lease_id, 'mietverhaeltnisse', 'read')
  );

create policy lease_cloud_folders_update_own on public.lease_cloud_folders
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.cloud_connections c
       where c.id = lease_cloud_folders.cloud_connection_id
         and c.user_id = auth.uid()
    )
    and public.has_lease_access(lease_id, 'mietverhaeltnisse', 'read')
  );

create policy lease_cloud_folders_delete_own on public.lease_cloud_folders
  for delete to authenticated
  using (user_id = auth.uid());
