-- =============================================================================
-- Welle 5 · Paket Q_CLAIM_LINKS_DB (28.11.2026): kein Klartext mehr in claim_access_links
--
-- Befund (Abgleich 28.11.): 14 Zeilen, 0 gültig. 8 Altzeilen enthalten in token_hash
--   (32 Zeichen) und pin_hash (5 Ziffern) den KLARTEXT statt eines Hashes. Weitere 6 Zeilen
--   haben zwar einen SHA-256-Token-Hash, als pin_hash aber einen ungesalzenen SHA-256 der
--   5- bis 8-stelligen PIN (64 Hex-Zeichen, per Durchprobieren sofort umkehrbar = faktisch
--   Klartext). Die Spalten token/pin sind seit claims_portal_finalize_w3 (20261128020547)
--   überall NULL. Bezug: G15-05, G17b-12, R1-08, D3a-16 (Welle 3, Paket 07/07b).
--
-- Prüfverfahren (Live-Katalog = Repo 20261128012918/20261128020547):
--   claim_portal_check_access(p_token, p_pin):
--     token_hash = encode(extensions.digest(btrim(p_token), 'sha256'), 'hex')   (64 Hex, klein)
--     PIN:  extensions.crypt(btrim(p_pin), pin_hash) = pin_hash                 (bcrypt)
--   create_claim_portal_link / generate_claim_access_link schreiben
--     token_hash = encode(extensions.digest(<token>, 'sha256'), 'hex')
--     pin_hash   = extensions.crypt(<pin>, extensions.gen_salt('bf', 8))        ($2a$08$…, 60 Z.)
--   Kein Pepper/Vault – das Verfahren ist reproduzierbar.
--
-- Wirkung:
--   1. Altzeilen (erkannt am FORMAT, nicht an IDs):
--      - token_hash nicht im Format ^[0-9a-f]{64}$ (= Klartext-Token)
--          -> mit genau dem Prüfverfahren gehasht (SHA-256 hex von btrim(Token));
--      - pin_hash nicht im bcrypt-Format:
--          * 5–8 Ziffern (= Klartext-PIN) -> bcrypt wie in den Erzeugern (gen_salt('bf', 8));
--          * sonst (z. B. ungesalzener SHA-256) -> bcrypt eines unbekannten Zufallswerts
--            (passt nie wieder auf eine PIN);
--      - jede so umgestellte Zeile wird zusätzlich widerrufen (is_active = false,
--        revoked_at = coalesce(revoked_at, now())): der Klartext lag lesbar in der Tabelle,
--        die Zugangsdaten gelten als verbraucht. Damit wird kein abgelaufener/inaktiver Link
--        wieder gültig – auch nicht, wenn eine Altzeile wider Erwarten noch nicht abgelaufen
--        wäre. Live betroffen: 14 Zeilen, alle bereits abgelaufen (0 gültig) – für Mieter und
--        App ändert sich nichts.
--   2. generate_claim_access_link und create_claim_portal_link (Signaturen, Rückgaben, Rechte
--      unverändert) schreiben die Spalten token/pin nicht mehr (bisher nur NULL).
--   3. Spalten token/pin entfernt (samt CHECK claim_access_links_no_plaintext). Sonst nutzt sie
--      nichts mehr: keine Sicht, Policy, Trigger, kein Index, keine weitere Funktion, App
--      (immo-web/src) und Edge Functions lesen/schreiben sie nicht.
--   4. CHECK: token_hash nur noch SHA-256 hex (64, klein), pin_hash nur noch bcrypt.
--
-- Idempotent: mehrfaches Ausführen ist unschädlich (Schritt 1 findet danach keine Zeile mehr).
-- Rollback: _fixwork/sql/wave5/rollback/07_claim-links-db.rollback.sql (Klartext wird bewusst
--   nicht wiederhergestellt).
-- =============================================================================

-- 0. Voraussetzung: Prüfverfahren wie oben (sonst würden die Hashes nicht passen)
do $do$
begin
  if not exists (select 1 from pg_proc
                  where oid = 'public.claim_portal_check_access(text,text)'::regprocedure
                    and prosrc like '%token_hash = v_token_hash%'
                    and prosrc like '%extensions.digest(btrim(p_token), ''sha256'')%'
                    and prosrc like '%extensions.crypt(btrim(p_pin), v_link.pin_hash) = v_link.pin_hash%') then
    raise exception 'claim_portal_check_access prüft nicht (mehr) per SHA-256/bcrypt – 07_claim-links-db abgebrochen';
  end if;
end $do$;


-- 1. Altzeilen ohne Klartext (Erkennung über das Format)
with legacy as (
  select l.id,
         (l.token_hash is not null and l.token_hash !~ '^[0-9a-f]{64}$') as fix_token,
         (l.pin_hash is not null and l.pin_hash !~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$') as fix_pin
    from public.claim_access_links l
   where (l.token_hash is not null and l.token_hash !~ '^[0-9a-f]{64}$')
      or (l.pin_hash is not null and l.pin_hash !~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$')
     for update
)
update public.claim_access_links l
   set token_hash = case when g.fix_token
                         then encode(extensions.digest(btrim(l.token_hash), 'sha256'), 'hex')
                         else l.token_hash end,
       pin_hash   = case when not g.fix_pin
                           then l.pin_hash
                         when btrim(l.pin_hash) ~ '^[0-9]{5,8}$'
                           then extensions.crypt(btrim(l.pin_hash), extensions.gen_salt('bf', 8))
                         else extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'),
                                               extensions.gen_salt('bf', 8)) end,
       is_active  = false,
       revoked_at = coalesce(l.revoked_at, now())
  from legacy g
 where g.id = l.id;


-- 2. Erzeuger ohne token/pin (sonst unverändert; ACL und Kommentar bleiben bei create or replace)
create or replace function public.generate_claim_access_link(p_claim_id uuid, p_token text, p_pin text, p_expires_days integer default 14)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_claim_owner uuid;
  v_token text := btrim(coalesce(p_token, ''));
  v_pin text := btrim(coalesce(p_pin, ''));
  v_days integer := coalesce(p_expires_days, 14);
  v_bytes bytea;
  v_link_id uuid;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet.' using errcode = '42501';
  end if;

  select c.user_id into v_claim_owner from public.claims c where c.id = p_claim_id;
  if not found
     or (v_claim_owner is distinct from v_uid
         and not coalesce(public.has_claim_access(p_claim_id, 'finanzen', 'write'), false)) then
    raise exception 'Forderung nicht gefunden oder keine Berechtigung, einen Portal-Link zu erstellen.'
      using errcode = '42501';
  end if;

  if v_days < 1 or v_days > 90 then
    raise exception 'Die Gültigkeit des Portal-Links muss zwischen 1 und 90 Tagen liegen.';
  end if;

  if length(v_token) < 32 or length(v_token) > 128 or v_token !~ '^[A-Za-z0-9_-]+$'
     or exists (select 1 from public.claim_access_links l
                 where l.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')) then
    v_token := encode(extensions.gen_random_bytes(16), 'hex');
  end if;

  if v_pin !~ '^[0-9]{5,8}$' then
    v_bytes := extensions.gen_random_bytes(4);
    v_pin := (100000 + ((get_byte(v_bytes, 0)::bigint * 16777216
                         + get_byte(v_bytes, 1) * 65536
                         + get_byte(v_bytes, 2) * 256
                         + get_byte(v_bytes, 3)) % 900000))::text;
  end if;

  update public.claim_access_links
     set is_active = false,
         revoked_at = coalesce(revoked_at, now())
   where claim_id = p_claim_id
     and (is_active is distinct from false or revoked_at is null);

  insert into public.claim_access_links (claim_id, token_hash, pin_hash, expires_at, created_by, is_active)
  values (p_claim_id,
          encode(extensions.digest(v_token, 'sha256'), 'hex'),
          extensions.crypt(v_pin, extensions.gen_salt('bf', 8)),
          now() + make_interval(days => v_days),
          v_uid,
          true)
  returning id into v_link_id;

  return v_link_id;
end;
$function$;

revoke all on function public.generate_claim_access_link(uuid, text, text, integer) from public, anon;
grant execute on function public.generate_claim_access_link(uuid, text, text, integer) to authenticated, service_role;


create or replace function public.create_claim_portal_link(p_claim_id uuid, p_expires_days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_days integer := coalesce(p_expires_days, 14);
  v_token text;
  v_token_hash text;
  v_pin text;
  v_bytes bytea;
  v_value bigint;
  v_tries integer := 0;
  v_link_id uuid;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet.' using errcode = '42501';
  end if;

  select c.user_id into v_owner from public.claims c where c.id = p_claim_id for update;
  if not found
     or (v_owner is distinct from v_uid
         and not coalesce(public.has_claim_access(p_claim_id, 'finanzen', 'write'), false)) then
    raise exception 'Forderung nicht gefunden oder keine Berechtigung, einen Portal-Link zu erstellen.'
      using errcode = '42501';
  end if;

  if v_days < 1 or v_days > 90 then
    raise exception 'Die Gültigkeit des Portal-Links muss zwischen 1 und 90 Tagen liegen.';
  end if;

  loop
    v_tries := v_tries + 1;
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
    exit when not exists (select 1 from public.claim_access_links l where l.token_hash = v_token_hash);
    if v_tries >= 5 then
      raise exception 'Der Portal-Link konnte nicht erzeugt werden. Bitte erneut versuchen.';
    end if;
  end loop;

  -- 6-stellige PIN gleichverteilt (Zufallswerte >= 4772 * 900000 werden verworfen)
  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_value := get_byte(v_bytes, 0)::bigint * 16777216
             + get_byte(v_bytes, 1)::bigint * 65536
             + get_byte(v_bytes, 2)::bigint * 256
             + get_byte(v_bytes, 3)::bigint;
    exit when v_value < 4294800000;
  end loop;
  v_pin := (100000 + v_value % 900000)::text;

  update public.claim_access_links
     set is_active = false,
         revoked_at = coalesce(revoked_at, now())
   where claim_id = p_claim_id
     and (is_active is distinct from false or revoked_at is null);

  v_expires := now() + make_interval(days => v_days);

  insert into public.claim_access_links (claim_id, token_hash, pin_hash, expires_at, created_by, is_active)
  values (p_claim_id, v_token_hash, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)),
          v_expires, v_uid, true)
  returning id into v_link_id;

  return jsonb_build_object('link_id', v_link_id, 'token', v_token, 'pin', v_pin, 'expires_at', v_expires);
end;
$function$;

revoke all on function public.create_claim_portal_link(uuid, integer) from public, anon;
grant execute on function public.create_claim_portal_link(uuid, integer) to authenticated, service_role;


-- 3. Spalten token/pin entfernen – nur wenn keine Funktion sie mehr anspricht
do $do$
declare
  v_fn text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prosrc ilike '%claim_access_links%'
     and (p.prosrc ~* 'claim_access_links\s*\([^)]*\m(token|pin)\M\s*[,)]'
          or p.prosrc ~* '\.(token|pin)\M\s*(=|is|,|\))');
  if v_fn is not null then
    raise exception 'Spalten claim_access_links.token/pin werden noch verwendet von: % – 07_claim-links-db abgebrochen', v_fn;
  end if;
end $do$;

alter table public.claim_access_links drop constraint if exists claim_access_links_no_plaintext;
alter table public.claim_access_links
  drop column if exists token,
  drop column if exists pin;


-- 4. Nur noch Hash-Formate erlaubt (beide Erzeuger liefern immer genau diese Formate)
do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.claim_access_links'::regclass
                    and conname = 'claim_access_links_token_hash_sha256') then
    alter table public.claim_access_links
      add constraint claim_access_links_token_hash_sha256
      check (token_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.claim_access_links'::regclass
                    and conname = 'claim_access_links_pin_hash_bcrypt') then
    alter table public.claim_access_links
      add constraint claim_access_links_pin_hash_bcrypt
      check (pin_hash ~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$');
  end if;
end $do$;

comment on column public.claim_access_links.token_hash is
  'SHA-256 (hex, klein) des Portal-Tokens; Prüfung in claim_portal_check_access. Klartext wird nie gespeichert.';
comment on column public.claim_access_links.pin_hash is
  'bcrypt-Hash der Portal-PIN (extensions.crypt/gen_salt(''bf'', 8)); Prüfung in claim_portal_check_access. Klartext wird nie gespeichert.';

notify pgrst, 'reload schema';
