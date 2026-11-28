-- =============================================================================
-- wave3/02_SMTP-MAIL.sql · Paket SMTP-MAIL (Komplett-Check 2026-11-27, Welle 3)
--
-- 1. SMTP-Passwort nur noch verschlüsselt im Supabase Vault (M2-05, E2-10, G04-04, D3b-17)
--    • Neue Spalte user_smtp_settings.smtp_pass_secret_id (Verweis auf vault.secrets).
--    • BEFORE INSERT/UPDATE-Trigger: ein mitgeschicktes smtp_pass wird in den Vault
--      geschrieben (vault.create_secret bzw. vault.update_secret, Name 'smtp_pass:<user_id>'),
--      danach smtp_pass := NULL. Die App schreibt weiter wie bisher per Insert/Update –
--      der Klartext landet nie in der Tabelle.
--    • CHECK (smtp_pass IS NULL): Klartext kann auch ohne Trigger nicht gespeichert werden.
--    • Wechselt Server oder Benutzername ohne neues Passwort, wird das Speichern abgelehnt
--      (ein gespeichertes Passwort darf nicht an einen anderen Server gehen).
--    • AFTER DELETE-Trigger: „Verbindung trennen“ bzw. Löschen des Kontos entfernt das Secret.
--    • get_smtp_password(p_user_id) – nur service_role (Edge Function send-letting-email).
--    • Spaltenrechte: authenticated darf smtp_pass_secret_id weder lesen noch schreiben,
--      user_id/id nach dem Anlegen nicht ändern.
--    • Bestandszeilen werden in den Vault übernommen und smtp_pass geleert.
-- 2. Dauerhafte Idempotenz der öffentlichen Prozess-Mails (E2-09):
--    rental_applicants.received_mail_sent_at, rental_viewing_bookings.confirmed_mail_sent_at,
--    rental_viewing_bookings.canceled_mail_sent_at (timestamptz, NULL = noch nicht verschickt).
-- 3. get_auth_user_id_by_email(p_email) – nur service_role; für das Widerrufen
--    zurückgezogener Mieter-Einladungen in send-letting-email (G19-08).
--
-- Reihenfolge beim Ausrollen: ZUERST die neue Edge Function send-letting-email deployen
-- (liest das Passwort per get_smtp_password und fällt ohne diese Migration auf die alte
-- Spalte zurück), DANN diese Migration einspielen. Die heute live ausgelieferte Edge
-- Function liest smtp_pass im Klartext und fände nach dieser Migration kein Passwort mehr.
-- Die heute live ausgelieferte App (EmailSettings per Insert/Update) bleibt verträglich.
-- Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. SMTP-Passwort im Vault
-- ---------------------------------------------------------------------------
alter table public.user_smtp_settings add column if not exists smtp_pass_secret_id uuid;
alter table public.user_smtp_settings alter column smtp_pass drop not null;

comment on column public.user_smtp_settings.smtp_pass is
  'Nur Eingabekanal: wird vom Trigger trg_user_smtp_settings_secure_pass in den Vault verschoben und ist immer NULL.';
comment on column public.user_smtp_settings.smtp_pass_secret_id is
  'Verweis auf vault.secrets (Name smtp_pass:<user_id>). Nur über get_smtp_password (service_role) lesbar.';

create or replace function public.user_smtp_settings_secure_pass()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_secret_id uuid;
  v_new_pass text := nullif(new.smtp_pass, '');
  v_has_stored boolean := false;
begin
  -- Angemeldete Nutzer nur für die eigene Zeile (vor dem Vault-Zugriff; RLS prüft erst danach)
  if v_uid is not null and new.user_id is distinct from v_uid then
    raise exception 'Keine Berechtigung für diese E-Mail-Einstellungen.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'Die Zuordnung der E-Mail-Einstellungen kann nicht geändert werden.' using errcode = '42501';
    end if;
    -- Der Vault-Verweis wird nur hier im Trigger gesetzt, nie vom Aufrufer
    new.smtp_pass_secret_id := old.smtp_pass_secret_id;
    v_has_stored := old.smtp_pass_secret_id is not null or nullif(old.smtp_pass, '') is not null;

    if v_new_pass is null and v_has_stored and (
         lower(btrim(coalesce(new.smtp_host, ''))) is distinct from lower(btrim(coalesce(old.smtp_host, '')))
         or btrim(coalesce(new.smtp_user, '')) is distinct from btrim(coalesce(old.smtp_user, ''))
       ) then
      raise exception 'Bei geändertem SMTP-Server oder Benutzernamen geben Sie bitte das Passwort erneut ein.'
        using errcode = '22023';
    end if;
  else
    new.smtp_pass_secret_id := null;
  end if;

  if v_new_pass is not null then
    v_name := 'smtp_pass:' || new.user_id::text;
    select s.id into v_secret_id from vault.secrets s where s.name = v_name;
    if v_secret_id is null then
      v_secret_id := vault.create_secret(v_new_pass, v_name, 'SMTP-Passwort (user_smtp_settings)');
    else
      perform vault.update_secret(v_secret_id, v_new_pass);
    end if;
    new.smtp_pass_secret_id := v_secret_id;
  end if;

  new.smtp_pass := null;
  return new;
end;
$$;

create or replace function public.user_smtp_settings_drop_secret()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Nur über den Namen löschen (nie über einen fremden Verweis)
  delete from vault.secrets s where s.name = 'smtp_pass:' || old.user_id::text;
  return old;
end;
$$;

revoke execute on function public.user_smtp_settings_secure_pass() from public, anon, authenticated;
revoke execute on function public.user_smtp_settings_drop_secret() from public, anon, authenticated;

drop trigger if exists trg_user_smtp_settings_secure_pass on public.user_smtp_settings;
create trigger trg_user_smtp_settings_secure_pass
  before insert or update on public.user_smtp_settings
  for each row execute function public.user_smtp_settings_secure_pass();

drop trigger if exists trg_user_smtp_settings_drop_secret on public.user_smtp_settings;
create trigger trg_user_smtp_settings_drop_secret
  after delete on public.user_smtp_settings
  for each row execute function public.user_smtp_settings_drop_secret();

-- Bestandsdaten: Klartext in den Vault übernehmen (der Trigger erledigt das), leere Werte auf NULL
update public.user_smtp_settings set smtp_pass = smtp_pass where smtp_pass is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.user_smtp_settings'::regclass
       and conname = 'user_smtp_settings_no_plaintext_pass'
  ) then
    alter table public.user_smtp_settings
      add constraint user_smtp_settings_no_plaintext_pass check (smtp_pass is null);
  end if;
end $$;

-- Lesen des Passworts nur für die Edge Function (service_role)
create or replace function public.get_smtp_password(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.decrypted_secret
    from public.user_smtp_settings s
    join vault.decrypted_secrets d
      on d.id = s.smtp_pass_secret_id
     and d.name = 'smtp_pass:' || s.user_id::text
   where s.user_id = p_user_id
   limit 1
$$;

revoke execute on function public.get_smtp_password(uuid) from public, anon, authenticated;
grant execute on function public.get_smtp_password(uuid) to service_role;

-- Spaltenrechte: Schreiben nur auf die Felder, die die App setzt; smtp_pass_secret_id gar nicht.
-- (REVOKE auf Tabellenebene entfernt auch Spaltenrechte derselben Art; SELECT bleibt unberührt.)
revoke insert, update on table public.user_smtp_settings from authenticated;
revoke all on table public.user_smtp_settings from anon;
grant insert (user_id, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_sender, updated_at)
  on public.user_smtp_settings to authenticated;
grant update (smtp_host, smtp_port, smtp_user, smtp_pass, smtp_sender, updated_at)
  on public.user_smtp_settings to authenticated;
revoke select (smtp_pass, smtp_pass_secret_id) on public.user_smtp_settings from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Idempotenz der öffentlichen Prozess-Mails
-- ---------------------------------------------------------------------------
alter table public.rental_applicants add column if not exists received_mail_sent_at timestamptz;
alter table public.rental_viewing_bookings add column if not exists confirmed_mail_sent_at timestamptz;
alter table public.rental_viewing_bookings add column if not exists canceled_mail_sent_at timestamptz;

comment on column public.rental_applicants.received_mail_sent_at is
  'Zeitpunkt, zu dem send-letting-email die Eingangsbestätigung belegt/verschickt hat (NULL = noch nicht).';
comment on column public.rental_viewing_bookings.confirmed_mail_sent_at is
  'Zeitpunkt, zu dem send-letting-email die Terminbestätigung belegt/verschickt hat (NULL = noch nicht).';
comment on column public.rental_viewing_bookings.canceled_mail_sent_at is
  'Zeitpunkt, zu dem send-letting-email die Absagebestätigung belegt/verschickt hat (NULL = noch nicht).';

-- ---------------------------------------------------------------------------
-- 3. Auth-Konto zu einer E-Mail-Adresse (nur service_role)
-- ---------------------------------------------------------------------------
create or replace function public.get_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
    from auth.users u
   where p_email is not null
     and btrim(p_email) <> ''
     and lower(btrim(u.email)) = lower(btrim(p_email))
   order by u.created_at
   limit 1
$$;

revoke execute on function public.get_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.get_auth_user_id_by_email(text) to service_role;
