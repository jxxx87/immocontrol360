-- =============================================================================
-- SEC-ROLES (Komplett-Check 2026-11-27): Rollen, Mieter-Einladungen,
-- Mieterdaten-Links, Mieter-Löschung, Spaltenschutz für Mieter-Selbständerung.
--
-- Befunde:
--   user_roles selbst beschreibbar ........ D2-02, D3a-02, D3b-02, M1-01, M1-02, G01-01,
--                                            G22-01, M2-02 (Rollen-Teil), G19-16, D4-15 (teilw.)
--   neue Einladungs-RPC (Vertrag C4) ...... G01-01, G01-12, G19-01, G19-07 (Server-Teil), D3b-05 (teilw.)
--   tenant_invitations ................... D3b-08, M2-13, G19-01 (Vermieter-Konten nicht einladbar)
--   tenant_verification_links ............. G17b-01, G19-03, M2-03 (Policy, Token-Hash, Altlinks ungültig)
--   get_/update_tenant_by_token ........... D2-10, M2-07, G17b-07, G17b-08, G19-10, G17b-14, D2-11 (teilw.)
--   delete_tenant_completely .............. D2-03, X2-02, G19-01
--   tenants Spaltenschutz ................. G21-05, D3b-07, M2-02; bremst zusätzlich die Schreibseite
--                                            von D2-01 / M2-01 (fremde Kontakte -> fremde Mieter)
--   get_my_role ........................... search_path, deterministische Auswahl
--   Sicht tenant_auth_info ................ D4-19 (Supabase-Advisor: security definer view / auth.users)
--
-- Voraussetzung: 20261127100000_sec_access_helpers.sql (has_*_access mit Kategorie).
-- Idempotent: mehrfaches Ausführen ist unschädlich.
--
-- Kompatibilität:
--   * Alte App-Versionen (Android) legen die Mieterrolle noch selbst an. Das bleibt
--     erlaubt, aber nur für eine Zeile role='tenant', die exakt zu einer offenen
--     Einladung für die (bestätigte) E-Mail des Kontos passt, und nur für Konten ohne
--     eigene Portfolios. Die Einladung wird dann per Trigger als angenommen markiert.
--   * Neue App: RPC accept_tenant_invitation() (fällt bei fehlender Funktion zurück).
--   * Mieterdaten-Links: Der Klartext-Token wird nicht mehr gespeichert. Die neue App
--     zeigt den Link nur direkt nach dem Erstellen; alte App-Versionen zeigen für neue
--     Links einen unbrauchbaren Link (Sicherheit vor Komfort). Alle bestehenden Links
--     werden ungültig.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Hilfsfunktionen
-- -----------------------------------------------------------------------------

-- Darf das angemeldete Konto sich selbst eine Mieterrolle mit genau diesen IDs anlegen?
-- (nur für alte App-Versionen; die neue App nutzt accept_tenant_invitation)
create or replace function public.can_self_assign_tenant_role(p_tenant_id uuid, p_unit_id uuid, p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and p_tenant_id is not null
     -- Vermieter-Konten (eigene Portfolios) werden nie zu Mietern
     and not exists (select 1 from public.portfolios p where p.user_id = auth.uid())
     -- höchstens eine Rolle je Konto
     and not exists (select 1 from public.user_roles r where r.user_id = auth.uid())
     and exists (
       select 1
       from public.tenant_invitations i
       join auth.users u on u.id = auth.uid()
       where i.tenant_id = p_tenant_id
         and i.unit_id is not distinct from p_unit_id
         and i.property_id is not distinct from p_property_id
         -- nur offene Einladungen (die alte App sucht ebenfalls nur 'pending'); eine liegen
         -- gebliebene angenommene Einladung erlaubt nach entzogenem Zugang keine Selbstvergabe
         and i.status = 'pending'
         and u.email is not null
         and u.email_confirmed_at is not null
         and lower(trim(i.email)) = lower(trim(u.email))
     )
$$;

-- SHA-256 eines Mieterdaten-Link-Tokens (hex). Ohne Erweiterung (pg_catalog.sha256).
create or replace function public.tenant_link_token_hash(p_token text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_token is null or btrim(p_token) = '' then null
    else encode(sha256(convert_to(btrim(p_token), 'UTF8')), 'hex')
  end
$$;


-- -----------------------------------------------------------------------------
-- 2. get_my_role: fester search_path, deterministische Auswahl
-- -----------------------------------------------------------------------------
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.role from public.user_roles r
  where r.user_id = auth.uid()
  order by r.created_at, r.id
  limit 1;
$$;


-- -----------------------------------------------------------------------------
-- 3. Einladung serverseitig annehmen (Vertrag C4)
--    Liefert {role, tenant_id, unit_id, property_id, id} oder null.
--    Vorhandene Rolle wird unverändert zurückgegeben (idempotent).
-- -----------------------------------------------------------------------------
create or replace function public.accept_tenant_invitation()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_role public.user_roles%rowtype;
  v_inv public.tenant_invitations%rowtype;
begin
  if v_uid is null then
    return null;
  end if;

  -- parallele Aufrufe desselben Kontos (Seitenstart + Auth-Ereignis) nacheinander
  perform pg_advisory_xact_lock(hashtext('accept_tenant_invitation'), hashtext(v_uid::text));

  select * into v_role from public.user_roles
  where user_id = v_uid
  order by created_at, id
  limit 1;
  if found then
    return jsonb_build_object(
      'role', v_role.role, 'tenant_id', v_role.tenant_id, 'unit_id', v_role.unit_id,
      'property_id', v_role.property_id, 'id', v_role.id);
  end if;

  -- Konten mit eigenen Portfolios (Vermieter) nie in Mieter-Konten umwandeln
  if exists (select 1 from public.portfolios p where p.user_id = v_uid) then
    return null;
  end if;

  select lower(trim(u.email)), u.email_confirmed_at
    into v_email, v_confirmed
  from auth.users u
  where u.id = v_uid;

  if v_email is null or v_email = '' or v_confirmed is null then
    return null;
  end if;

  select i.* into v_inv
  from public.tenant_invitations i
  join public.tenants t on t.id = i.tenant_id
  where lower(trim(i.email)) = v_email
    and i.status = 'pending'
  order by i.created_at desc, i.id
  limit 1
  for update of i;

  if not found then
    return null;
  end if;

  insert into public.user_roles (user_id, role, tenant_id, unit_id, property_id)
  values (v_uid, 'tenant', v_inv.tenant_id, v_inv.unit_id, v_inv.property_id)
  returning * into v_role;

  update public.tenant_invitations set status = 'accepted' where id = v_inv.id;

  return jsonb_build_object(
    'role', v_role.role, 'tenant_id', v_role.tenant_id, 'unit_id', v_role.unit_id,
    'property_id', v_role.property_id, 'id', v_role.id);
end;
$$;


-- -----------------------------------------------------------------------------
-- 4. user_roles: keine Selbst-Vergabe mehr, Vermieter nur für eigene Mieter
-- -----------------------------------------------------------------------------
alter table public.user_roles enable row level security;

drop policy if exists "investors_manage_own_roles" on public.user_roles;
drop policy if exists "new_users_can_set_role" on public.user_roles;
drop policy if exists "tenants_read_own_role" on public.user_roles;
drop policy if exists "users_read_own_role" on public.user_roles;
drop policy if exists "user_roles_select_own" on public.user_roles;
drop policy if exists "user_roles_select_landlord" on public.user_roles;
drop policy if exists "user_roles_insert_invited_tenant" on public.user_roles;
drop policy if exists "user_roles_update_landlord" on public.user_roles;
drop policy if exists "user_roles_delete_landlord" on public.user_roles;

create policy "user_roles_select_own" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid());

-- Vermieter/Mitnutzer sehen die Portal-Rollen ihrer Mieter (auch ohne property_id, G19-16)
create policy "user_roles_select_landlord" on public.user_roles
  for select to authenticated
  using (
    role = 'tenant'
    and (
      public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'read')
      or (property_id is not null and public.has_property_access(property_id, 'mietverhaeltnisse', 'read'))
    )
  );

-- Nur noch für alte App-Versionen: eigene Mieterrolle exakt laut Einladung
create policy "user_roles_insert_invited_tenant" on public.user_roles
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = 'tenant'
    and public.can_self_assign_tenant_role(tenant_id, unit_id, property_id)
  );

create policy "user_roles_update_landlord" on public.user_roles
  for update to authenticated
  using (
    role = 'tenant'
    and public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'write')
  )
  with check (
    role = 'tenant'
    and public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'write')
    and (unit_id is null or public.has_unit_access(unit_id, 'mietverhaeltnisse', 'write'))
    and (property_id is null or public.has_property_access(property_id, 'mietverhaeltnisse', 'write'))
  );

create policy "user_roles_delete_landlord" on public.user_roles
  for delete to authenticated
  using (
    role = 'tenant'
    and (
      public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'write')
      or (property_id is not null and public.has_property_access(property_id, 'mietverhaeltnisse', 'write'))
    )
  );

-- Konto und Rolle einer Rollenzeile sind für Clients unveränderlich (still alten Wert behalten)
create or replace function public.user_roles_protect_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    new.id := old.id;
    new.user_id := old.user_id;
    new.role := old.role;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_user_roles_protect_identity on public.user_roles;
create trigger trg_user_roles_protect_identity
  before update on public.user_roles
  for each row execute function public.user_roles_protect_identity();

-- Alte App-Versionen markieren die Einladung selbst als angenommen; dafür gibt es
-- keine UPDATE-Policy mehr. Das übernimmt dieser Trigger.
create or replace function public.user_roles_mark_invitation_accepted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role = 'tenant' and new.tenant_id is not null then
    update public.tenant_invitations i
       set status = 'accepted'
      from auth.users u
     where u.id = new.user_id
       and i.tenant_id = new.tenant_id
       and i.status = 'pending'
       and lower(trim(i.email)) = lower(trim(u.email));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_user_roles_mark_invitation_accepted on public.user_roles;
create trigger trg_user_roles_mark_invitation_accepted
  after insert on public.user_roles
  for each row execute function public.user_roles_mark_invitation_accepted();


-- -----------------------------------------------------------------------------
-- 5. tenant_invitations: nur Einladender/Vermieter; Eingeladene lesen nur eigene
-- -----------------------------------------------------------------------------
alter table public.tenant_invitations enable row level security;

drop policy if exists "investors_manage_own_invitations" on public.tenant_invitations;
drop policy if exists "shared_users_access" on public.tenant_invitations;
drop policy if exists "users_read_own_invitation" on public.tenant_invitations;
drop policy if exists "users_update_own_invitation" on public.tenant_invitations;
drop policy if exists "tenant_invitations_select_invitee" on public.tenant_invitations;
drop policy if exists "tenant_invitations_select_landlord" on public.tenant_invitations;
drop policy if exists "tenant_invitations_insert_landlord" on public.tenant_invitations;
drop policy if exists "tenant_invitations_update_landlord" on public.tenant_invitations;
drop policy if exists "tenant_invitations_delete_landlord" on public.tenant_invitations;

-- Eingeladene Person: nur lesen, nur die eigenen (alte App sucht so ihre Einladung)
create policy "tenant_invitations_select_invitee" on public.tenant_invitations
  for select to authenticated
  using (
    coalesce(auth.jwt() ->> 'email', '') <> ''
    and lower(trim(email)) = lower(trim(auth.jwt() ->> 'email'))
  );

create policy "tenant_invitations_select_landlord" on public.tenant_invitations
  for select to authenticated
  using (
    invited_by = auth.uid()
    or public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'read')
  );

create policy "tenant_invitations_insert_landlord" on public.tenant_invitations
  for insert to authenticated
  with check (
    invited_by = auth.uid()
    and tenant_id is not null
    and public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'write')
    and (unit_id is null or public.has_unit_access(unit_id, 'mietverhaeltnisse', 'write'))
    and (property_id is null or public.has_property_access(property_id, 'mietverhaeltnisse', 'write'))
  );

create policy "tenant_invitations_update_landlord" on public.tenant_invitations
  for update to authenticated
  using (
    invited_by = auth.uid()
    or public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'write')
  )
  with check (
    tenant_id is not null
    and public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'write')
    and (unit_id is null or public.has_unit_access(unit_id, 'mietverhaeltnisse', 'write'))
    and (property_id is null or public.has_property_access(property_id, 'mietverhaeltnisse', 'write'))
  );

create policy "tenant_invitations_delete_landlord" on public.tenant_invitations
  for delete to authenticated
  using (
    invited_by = auth.uid()
    or public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'write')
  );

-- E-Mail normalisieren; keine Einladung an das eigene Konto oder an Vermieter-Konten (G19-01)
create or replace function public.tenant_invitations_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email_changed boolean;
begin
  new.email := lower(trim(new.email));
  if new.email is null or new.email = '' then
    raise exception 'Bitte geben Sie eine E-Mail-Adresse an.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    v_email_changed := true;
  else
    -- reine Statusänderungen (Annahme durch den Eingeladenen) nicht prüfen
    v_email_changed := new.email is distinct from lower(trim(old.email));
  end if;

  -- Prüfung nur für Aufrufer mit Schreibrecht auf den Mieter (sonst lehnt RLS ohnehin ab);
  -- verhindert, dass Fremde über die Fehlermeldung abfragen, ob eine E-Mail ein Vermieter-Konto ist
  if auth.uid() is not null and v_email_changed
     and public.has_tenant_access(new.tenant_id, 'mietverhaeltnisse', 'write') then
    if exists (select 1 from auth.users u
               where u.id = auth.uid() and lower(trim(u.email)) = new.email) then
      raise exception 'Sie können sich nicht selbst als Mieter einladen.' using errcode = '42501';
    end if;
    if exists (select 1 from auth.users u
               join public.portfolios p on p.user_id = u.id
               where lower(trim(u.email)) = new.email) then
      raise exception 'Diese E-Mail-Adresse gehört zu einem bestehenden Vermieter-Konto und kann nicht als Mieter eingeladen werden.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tenant_invitations_guard on public.tenant_invitations;
create trigger trg_tenant_invitations_guard
  before insert or update on public.tenant_invitations
  for each row execute function public.tenant_invitations_guard();


-- -----------------------------------------------------------------------------
-- 6. tenant_verification_links: nur Vermieter des Mieters, Token nur als Hash
-- -----------------------------------------------------------------------------
alter table public.tenant_verification_links add column if not exists token_hash text;

create unique index if not exists tenant_verification_links_token_hash_key
  on public.tenant_verification_links (token_hash)
  where token_hash is not null;

-- Beim Speichern hashen, Klartext durch eindeutigen Marker ersetzen
create or replace function public.tenant_verification_links_hash_token()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then
      new.created_by := auth.uid();
    end if;
  elsif auth.uid() is not null
        and new.created_by is not null
        and new.created_by is distinct from old.created_by then
    -- Ersteller nicht umschreibbar (ON DELETE SET NULL des Fremdschlüssels bleibt möglich)
    new.created_by := old.created_by;
  end if;

  if new.token is not null and new.token not like 'hashed:%' then
    new.token_hash := public.tenant_link_token_hash(new.token);
    new.token := 'hashed:' || new.id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tenant_verification_links_hash_token on public.tenant_verification_links;
create trigger trg_tenant_verification_links_hash_token
  before insert or update on public.tenant_verification_links
  for each row execute function public.tenant_verification_links_hash_token();

-- Bestand (nur Links mit Klartext-Token, also alle vor dieser Migration angelegten):
-- Klartext entfernen und ungültig machen. Bei erneutem Ausführen ohne Wirkung.
update public.tenant_verification_links
   set token_hash = coalesce(token_hash, public.tenant_link_token_hash(token)),
       token = 'hashed:' || id::text,
       expires_at = least(expires_at, now())
 where token not like 'hashed:%';

alter table public.tenant_verification_links enable row level security;

drop policy if exists "Allow authenticated full access to tenant_verification_links" on public.tenant_verification_links;
drop policy if exists "tenant_verification_links_select" on public.tenant_verification_links;
drop policy if exists "tenant_verification_links_insert" on public.tenant_verification_links;
drop policy if exists "tenant_verification_links_update" on public.tenant_verification_links;
drop policy if exists "tenant_verification_links_delete" on public.tenant_verification_links;

create policy "tenant_verification_links_select" on public.tenant_verification_links
  for select to authenticated
  using (
    created_by = auth.uid()
    or public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'read')
  );

create policy "tenant_verification_links_insert" on public.tenant_verification_links
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'write')
  );

create policy "tenant_verification_links_update" on public.tenant_verification_links
  for update to authenticated
  using (
    created_by = auth.uid()
    or public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'write')
  )
  with check (
    public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'write')
  );

create policy "tenant_verification_links_delete" on public.tenant_verification_links
  for delete to authenticated
  using (
    created_by = auth.uid()
    or public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'write')
  );


-- -----------------------------------------------------------------------------
-- 7. Öffentliche Token-RPCs (Signaturen unverändert)
-- -----------------------------------------------------------------------------
create or replace function public.get_tenant_by_token(p_token text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text := public.tenant_link_token_hash(p_token);
  v_link public.tenant_verification_links%rowtype;
  v_tenant public.tenants%rowtype;
  v_unit_name text;
  v_prop_street text;
  v_prop_house_number text;
  v_prop_postal_code text;
  v_prop_city text;
  v_use_property boolean;
begin
  if v_hash is null then
    return json_build_object('error', 'Link ist ungültig oder abgelaufen.');
  end if;

  select * into v_link
  from public.tenant_verification_links
  where token_hash = v_hash and expires_at > now()
  limit 1;

  if not found then
    return json_build_object('error', 'Link ist ungültig oder abgelaufen.');
  end if;

  -- Einmal-Link: nach erfolgreicher Aktualisierung keine Daten mehr herausgeben
  if v_link.is_updated then
    return json_build_object(
      'error', 'Dieser Link wurde bereits verwendet. Wenn Sie weitere Änderungen mitteilen möchten, wenden Sie sich bitte an Ihren Vermieter.',
      'used', true);
  end if;

  select * into v_tenant from public.tenants where id = v_link.tenant_id;
  if not found then
    return json_build_object('error', 'Mieter nicht gefunden.');
  end if;

  select u.unit_name, p.street, p.house_number, p.zip, p.city
    into v_unit_name, v_prop_street, v_prop_house_number, v_prop_postal_code, v_prop_city
  from public.leases l
  join public.units u on u.id = l.unit_id
  join public.properties p on p.id = u.property_id
  where l.tenant_id = v_tenant.id and l.status = 'active'
  order by l.start_date desc nulls last, l.id
  limit 1;

  -- Objektadresse nur als ganzer Block, wenn beim Mieter gar keine Anschrift steht (G17b-14)
  v_use_property := coalesce(nullif(btrim(v_tenant.street), ''), nullif(btrim(v_tenant.house_number), ''),
                             nullif(btrim(v_tenant.postal_code), ''), nullif(btrim(v_tenant.city), '')) is null
                    and v_prop_street is not null;

  return json_build_object(
    'first_name', v_tenant.first_name,
    'last_name', v_tenant.last_name,
    'street', coalesce(case when v_use_property then v_prop_street else v_tenant.street end, ''),
    'house_number', coalesce(case when v_use_property then v_prop_house_number else v_tenant.house_number end, ''),
    'postal_code', coalesce(case when v_use_property then v_prop_postal_code else v_tenant.postal_code end, ''),
    'city', coalesce(case when v_use_property then v_prop_city else v_tenant.city end, ''),
    'address_from_property', v_use_property,
    'phone', coalesce(v_tenant.phone, ''),
    'email', coalesce(v_tenant.email, ''),
    'unit_name', coalesce(v_unit_name, 'Keine aktive Zuordnung'),
    'expires_at', v_link.expires_at,
    'is_updated', v_link.is_updated
  );
end;
$$;

create or replace function public.update_tenant_by_token(
  p_token text, p_first_name text, p_last_name text, p_street text, p_house_number text,
  p_postal_code text, p_city text, p_phone text, p_email text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text := public.tenant_link_token_hash(p_token);
  v_link public.tenant_verification_links%rowtype;
  v_old public.tenants%rowtype;
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_street text := nullif(btrim(coalesce(p_street, '')), '');
  v_house text := nullif(btrim(coalesce(p_house_number, '')), '');
  v_zip text := nullif(btrim(coalesce(p_postal_code, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
begin
  if v_hash is null then
    return json_build_object('error', 'Link ist ungültig oder abgelaufen.');
  end if;

  select * into v_link
  from public.tenant_verification_links
  where token_hash = v_hash and expires_at > now()
  limit 1
  for update;

  if not found then
    return json_build_object('error', 'Link ist ungültig oder abgelaufen.');
  end if;

  if v_link.is_updated then
    return json_build_object(
      'error', 'Dieser Link wurde bereits verwendet. Wenn Sie weitere Änderungen mitteilen möchten, wenden Sie sich bitte an Ihren Vermieter.',
      'used', true);
  end if;

  select * into v_old from public.tenants where id = v_link.tenant_id for update;
  if not found then
    return json_build_object('error', 'Mieter nicht gefunden.');
  end if;

  -- Prüfungen (G17b-08): Pflichtfelder, Längen, E-Mail-Format
  if coalesce(v_first, v_old.first_name) is null and coalesce(v_last, v_old.last_name) is null then
    return json_build_object('error', 'Bitte geben Sie Ihren Vor- und Nachnamen an.');
  end if;
  if length(coalesce(v_first, '')) > 100 or length(coalesce(v_last, '')) > 100
     or length(coalesce(v_street, '')) > 200 or length(coalesce(v_house, '')) > 20
     or length(coalesce(v_zip, '')) > 20 or length(coalesce(v_city, '')) > 100
     or length(coalesce(v_phone, '')) > 50 or length(coalesce(v_email, '')) > 254 then
    return json_build_object('error', 'Eine Eingabe ist zu lang. Bitte kürzen Sie die Angaben.');
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return json_build_object('error', 'Bitte geben Sie eine gültige E-Mail-Adresse an.');
  end if;

  -- Spaltenschutz-Trigger auf tenants: nur die Felder dieses Formulars zulassen
  perform set_config('immo.tenant_update_source', 'token_link', true);

  update public.tenants
     set first_name = coalesce(v_first, v_old.first_name, ''),   -- leere Namen nicht übernehmen
         last_name = coalesce(v_last, v_old.last_name, ''),
         street = v_street,
         house_number = v_house,
         postal_code = v_zip,
         city = v_city,
         phone = v_phone,
         email = coalesce(v_email, v_old.email)                  -- leere E-Mail nicht übernehmen
   where id = v_old.id;

  perform set_config('immo.tenant_update_source', '', true);

  -- Einmal-Link: als verwendet markieren (danach liefern beide RPCs nur noch einen Hinweis)
  update public.tenant_verification_links
     set is_updated = true,
         updated_at = now()
   where id = v_link.id;

  return json_build_object('success', true);
end;
$$;


-- -----------------------------------------------------------------------------
-- 8. tenants: Mieter selbst darf nur die Kontaktfelder aus TenantStamdaten.jsx ändern
--    (Vorname, Nachname, Telefon, Straße, Hausnr., PLZ, Ort). Alles andere wird still
--    auf den alten Wert gesetzt. Fremde Änderungen ohne Schreibrecht werden verworfen.
-- -----------------------------------------------------------------------------
-- security definer: die Prüfung "Mieter hat keinen Mietvertrag" darf nicht von der
-- Sichtbarkeit (RLS) des Aufrufers abhängen; auth.uid() liefert weiterhin den Aufrufer.
create or replace function public.tenants_protect_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_source text := coalesce(current_setting('immo.tenant_update_source', true), '');
  v_row public.tenants%rowtype;
begin
  -- Mieterdaten-Link (update_tenant_by_token): genau die Formularfelder
  if v_source = 'token_link' then
    v_row := old;
    v_row.first_name := new.first_name;
    v_row.last_name := new.last_name;
    v_row.street := new.street;
    v_row.house_number := new.house_number;
    v_row.postal_code := new.postal_code;
    v_row.city := new.city;
    v_row.phone := new.phone;
    v_row.email := new.email;
    return v_row;
  end if;

  -- Serverseitig ohne Benutzerkontext (service_role, Wartung): unverändert
  if v_uid is null then
    return new;
  end if;

  -- Vermieter bzw. Mitnutzer mit Schreibrecht: unverändert (Policies regeln den Rest).
  -- Mieter ohne Mietvertrag dürfen Mitnutzer ändern, denen ein Portfolio des Vermieters
  -- mit Schreibrecht "mietverhaeltnisse" freigegeben ist (wie die tenants-Policies von
  -- SEC-POLICIES über rls_tenant_unleased_shared) – sonst würden deren Änderungen still verworfen.
  if old.user_id = v_uid
     or public.has_tenant_access(old.id, 'mietverhaeltnisse', 'write')
     or (not exists (select 1 from public.leases l where l.tenant_id = old.id)
         and exists (select 1 from public.portfolios po
                     where po.user_id = old.user_id
                       and public.has_portfolio_access(po.id, 'mietverhaeltnisse', 'write'))) then
    return new;
  end if;

  v_row := old;
  if exists (select 1 from public.user_roles ur
             where ur.user_id = v_uid and ur.role = 'tenant' and ur.tenant_id = old.id) then
    v_row.first_name := new.first_name;
    v_row.last_name := new.last_name;
    v_row.phone := new.phone;
    v_row.street := new.street;
    v_row.house_number := new.house_number;
    v_row.postal_code := new.postal_code;
    v_row.city := new.city;
  end if;
  return v_row;
end;
$$;

drop trigger if exists trg_tenants_protect_columns on public.tenants;
create trigger trg_tenants_protect_columns
  before update on public.tenants
  for each row execute function public.tenants_protect_columns();


-- -----------------------------------------------------------------------------
-- 9. delete_tenant_completely: Konto nur löschen, wenn es ausschließlich das
--    Mieter-Konto genau dieses Mieters ist (Einladung dieses Mieters, keine
--    Portfolios/Objekte/eigenen Mieter, keine weitere Rolle, nicht der Aufrufer).
--    Verträge/Forderungen/Dokumente/Kontakte verlieren wie bisher den Mieterbezug.
-- -----------------------------------------------------------------------------
create or replace function public.delete_tenant_completely(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_landlord_id uuid;
  v_account_ids uuid[];
  v_uid uuid;
begin
  select user_id into v_landlord_id from public.tenants where id = p_tenant_id;

  if v_caller is null or v_landlord_id is null or v_landlord_id <> v_caller then
    raise exception 'Not authorized to delete this tenant';
  end if;

  -- Portal-Konten, die nachweislich über eine Einladung für genau diesen Mieter entstanden sind
  select coalesce(array_agg(distinct ur.user_id), '{}')
    into v_account_ids
  from public.user_roles ur
  join auth.users u on u.id = ur.user_id
  where ur.tenant_id = p_tenant_id
    and ur.role = 'tenant'
    and ur.user_id <> v_caller
    and exists (select 1 from public.tenant_invitations i
                where i.tenant_id = p_tenant_id
                  and lower(trim(i.email)) = lower(trim(u.email)));

  update public.documents set tenant_id = null where tenant_id = p_tenant_id;
  update public.claims set tenant_id = null where tenant_id = p_tenant_id;
  update public.leases set tenant_id = null where tenant_id = p_tenant_id;
  update public.contacts set tenant_id = null where tenant_id = p_tenant_id;

  delete from public.tenant_verification_links where tenant_id = p_tenant_id;
  delete from public.tenant_invitations where tenant_id = p_tenant_id;
  delete from public.user_roles where tenant_id = p_tenant_id;

  foreach v_uid in array v_account_ids loop
    if not exists (select 1 from public.user_roles where user_id = v_uid)
       and not exists (select 1 from public.portfolios where user_id = v_uid)
       and not exists (select 1 from public.properties where user_id = v_uid)
       and not exists (select 1 from public.tenants where user_id = v_uid)
    then
      begin
        delete from public.profiles where id = v_uid;
        delete from auth.users where id = v_uid;
      exception when foreign_key_violation then
        -- Konto hängt noch an Daten (z. B. Forderungen): nur der Portalzugang ist entfernt
        null;
      end;
    end if;
  end loop;

  delete from public.tenants where id = p_tenant_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- 10. Sicht tenant_auth_info: kein SECURITY-DEFINER-View mehr über auth.users.
--     Die Sicht läuft als Aufrufer (security_invoker) und liest über eine
--     Funktion, die nur eigene bzw. Mieter mit Leserecht liefert.
-- -----------------------------------------------------------------------------
create or replace function public.get_tenant_auth_info()
returns table (tenant_user_id uuid, tenant_id uuid, registered_email character varying, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ur.user_id, ur.tenant_id, u.email::character varying, u.last_sign_in_at
  from public.user_roles ur
  join auth.users u on u.id = ur.user_id
  join public.tenants t on t.id = ur.tenant_id
  where ur.role = 'tenant'
    and auth.uid() is not null
    and (ur.user_id = auth.uid()
         or public.has_tenant_access(t.id, 'mietverhaeltnisse', 'read'))
$$;

create or replace view public.tenant_auth_info
with (security_invoker = true)
as
  select f.tenant_user_id,
         f.tenant_id,
         f.registered_email::character varying(255) as registered_email,
         f.last_sign_in_at
  from public.get_tenant_auth_info() f;

alter view public.tenant_auth_info set (security_invoker = true);
grant select on public.tenant_auth_info to authenticated;
