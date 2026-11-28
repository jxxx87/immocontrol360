-- =============================================================================
-- Wave 3 · Paket 07 CLAIMS-PORTAL, Abschluss: kein Klartext mehr in claim_access_links
-- Befunde: G15-05, G17b-12, R1-08, D3a-16
--
-- ERST EINSPIELEN, WENN
--   1. _fixwork/sql/wave3/07_claims-portal.sql eingespielt ist und
--   2. die neue App ausgerollt ist (ClaimDetail.jsx liest token/pin nicht mehr aus der Tabelle,
--      sondern erhält sie einmalig von create_claim_portal_link).
--   Die heute ausgelieferte App würde danach beim Laden der Forderungsakte den Hinweis
--   „Portal-Link konnte nicht geladen werden“ zeigen und keinen QR-Code mehr drucken.
--
-- Wirkung:
--   - generate_claim_access_link (Altweg, Signatur und Rückgabe unverändert) speichert nur noch
--     die Hashes.
--   - Vorhandener Klartext in token/pin wird gelöscht (Links bleiben über die Hashes gültig).
--   - CHECK claim_access_links_no_plaintext: token und pin müssen leer bleiben.
--   - authenticated: nur noch die Statusspalten lesbar (keine Hashes), änderbar nur is_active
--     und revoked_at (Widerrufen), kein direktes INSERT (Links nur über die RPCs).
--   Die Spalten token/pin bleiben vorerst bestehen (Rückbau), endgültig entfernen später.
--
-- Idempotent: mehrfaches Ausführen ist unschädlich.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.create_claim_portal_link(uuid,integer)') is null
     or not exists (select 1 from pg_proc
                     where oid = 'public.claim_portal_check_access(text,text)'::regprocedure
                       and prosrc like '%token_hash = v_token_hash%') then
    raise exception '07_claims-portal.sql ist nicht eingespielt – 07b_claims-portal-finalize abgebrochen';
  end if;
end $$;

-- 1. Altweg ohne Klartext (Token/PIN des Aufrufers werden übernommen, wenn gültig)
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

  insert into public.claim_access_links (claim_id, token, pin, token_hash, pin_hash, expires_at, created_by, is_active)
  values (p_claim_id,
          null,
          null,
          encode(extensions.digest(v_token, 'sha256'), 'hex'),
          extensions.crypt(v_pin, extensions.gen_salt('bf', 8)),
          now() + make_interval(days => v_days),
          v_uid,
          true)
  returning id into v_link_id;

  return v_link_id;
end;
$function$;

comment on function public.generate_claim_access_link(uuid, text, text, integer) is
  'Altweg (App bis 27.11.2026): legt einen Portal-Link mit vom Aufrufer erzeugtem Token/PIN an; gespeichert werden nur Hashes. Neue App: create_claim_portal_link.';

revoke all on function public.generate_claim_access_link(uuid, text, text, integer) from public, anon;
grant execute on function public.generate_claim_access_link(uuid, text, text, integer) to authenticated;

-- 2. Klartext löschen (Links bleiben über token_hash/pin_hash gültig)
update public.claim_access_links
   set token = null, pin = null
 where token is not null or pin is not null;

-- 3. Klartext dauerhaft ausschließen
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.claim_access_links'::regclass
                    and conname = 'claim_access_links_no_plaintext') then
    alter table public.claim_access_links
      add constraint claim_access_links_no_plaintext check (token is null and pin is null);
  end if;
end $$;

comment on column public.claim_access_links.token is 'Veraltet: immer NULL (Klartext wird nicht gespeichert, siehe token_hash). Wird später entfernt.';
comment on column public.claim_access_links.pin is 'Veraltet: immer NULL (Klartext wird nicht gespeichert, siehe pin_hash). Wird später entfernt.';

-- 4. Spaltenrechte: Status lesen, Widerrufen, kein direktes Anlegen; Hashes nicht lesbar
revoke all on public.claim_access_links from anon;
revoke all on public.claim_access_links from authenticated;
grant select (id, claim_id, expires_at, revoked_at, last_used_at, created_at, created_by, is_active)
  on public.claim_access_links to authenticated;
grant update (is_active, revoked_at) on public.claim_access_links to authenticated;
grant delete on public.claim_access_links to authenticated;

notify pgrst, 'reload schema';
