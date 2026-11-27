-- =============================================================================
-- DB-FUNCS-SEC (Komplett-Check 2026-11-27): übrige Datenbank-Funktionen
-- (Themen 4.7 Forderungsportal/Debug-Funktionen, 4.9 Kontakt-/Mieter-Abgleich,
--  5.1/5.3 Funktionen ohne festen search_path)
--
-- Befunde:
--   Debug-Reste löschen ...................... D1a-02, D2-08, H1-15, H1-04, (Teil von
--                                              D1a-01/H4-01/R1-01/H1-01: Quelle fremder claim_ids)
--   generate_claim_access_link ............... D1a-01, H4-01, R1-01 (Auth-Bypass für anon),
--                                              D1a-11/D4-04/G17b-12 (Teil: Token/PIN serverseitig,
--                                              *_hash-Spalten enthalten echte Hashes), D1a-16
--   get_public_claim_by_token ................ D1b-03/G15-01 (Widerruf), G17b-02/D1b-08/H4-12
--                                              (Fehlversuchs-Sperre), Vergleich nur noch Klartext-
--                                              Token (kein Login mit Hash-Wert, H4-12)
--   submit_public_payment_plan_request ....... G17b-03, G17b-04, G17b-05 (Serverteil), G17b-06
--                                              (Serverteil), H4-06, D1b-07, G17b-11 (Serverteil)
--   sync_contact_to_tenant / sync_tenant_to_contact / sync_lease_to_contact
--                                              D2-01, M2-01, D2-04 (Mandantenprüfung), D2-09,
--                                              D2-13 (nur geänderte Felder, Namens-/Hausnummer-
--                                              Logik), D2-12, M2-10 (Objektadresse überschreibt
--                                              keine eigene Mieteradresse), M2-24
--   get_investor_properties .................. SEC-ROLES-Querverweis (uid nur = auth.uid())
--   update_meter_last_reading + Trigger ...... D2-14, M1-09 (fremde Zähler), D2-19 (UPDATE/DELETE)
--   search_path .............................. D1a-16, M2-24, R1-14 (Teil) für alle Funktionen,
--                                              die keinem anderen Paket gehören (außer notify_push)
--
-- Voraussetzung: 20261127100000_sec_access_helpers.sql (has_*_access mit Kategorie).
-- Idempotent: mehrfaches Ausführen ist unschädlich.
-- Ausführungsrechte (REVOKE ... FROM anon/PUBLIC) setzt 109000_revoke_anon.sql zentral.
--
-- Kompatibilität mit der App:
--   * Alle bestehenden Signaturen und Rückgabetypen bleiben gleich.
--   * get_public_claim_by_token / submit_public_payment_plan_request melden eine FALSCHE
--     PIN nicht mehr per Exception, sondern als Ergebnis {error, code:'invalid_pin'}, damit
--     der Fehlversuch gespeichert bleibt (eine Exception würde ihn zurückrollen). Die neue
--     ClaimPortal.jsx wertet das aus. Alle übrigen Fehler bleiben Exceptions (HINT = Code).
--   * Fehlversuche werden – mangels eigener Spalten in claim_access_links – als
--     claim_events (event_type 'note_added', event_metadata.portal_event = 'pin_failed')
--     protokolliert. Der Vermieter sieht sie in der Forderungsakte.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Debug-Reste löschen (kein Aufrufer in App oder Edge Functions)
-- -----------------------------------------------------------------------------
drop function if exists public.debug_get_functions();
drop function if exists public.debug_get_info();
drop function if exists public.debug_get_last_payment();
drop function if exists public.debug_get_triggers();
drop function if exists public.debug_simulate_payment(uuid, date, numeric, text, uuid);
drop function if exists public.debug_trace_payment(uuid, numeric, uuid);
drop function if exists public.get_properties_policies();
drop function if exists public.get_random_active_plan();


-- -----------------------------------------------------------------------------
-- 2. Forderungsportal: Hilfsfunktionen
--    Bewusst SECURITY INVOKER: Aus den Portal-RPCs (SECURITY DEFINER) heraus laufen sie
--    mit den Rechten des Funktionseigentümers; direkt aufgerufen gilt RLS des Aufrufers
--    (anon sieht dann nichts).
-- -----------------------------------------------------------------------------

-- Ratenoptionen des Vermieters vereinheitlichen. Gleiche Regeln wie in ClaimPortal.jsx:
--   NULL -> Standardoptionen (wie bisher in get_public_claim_by_token),
--   JSON-Text -> wird geparst, kein Array -> Standardoptionen,
--   ungültige Einträge entfallen, je Laufzeit zählt der erste Eintrag,
--   leeres Array -> keine Ratenzahlung über das Portal ("Der Mieter wird keine Auswahl haben").
create or replace function public.claim_portal_installment_options(p_options jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_options jsonb := p_options;
  v_default constant jsonb := '[{"months": 3, "surcharge_percent": 7}, {"months": 6, "surcharge_percent": 9}, {"months": 12, "surcharge_percent": 12}]'::jsonb;
  v_result jsonb;
begin
  if v_options is null then
    return v_default;
  end if;

  if jsonb_typeof(v_options) = 'string' then
    begin
      v_options := (v_options #>> '{}')::jsonb;
    exception when others then
      return v_default;
    end;
  end if;

  if v_options is null or jsonb_typeof(v_options) <> 'array' then
    return v_default;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('months', x.months, 'surcharge_percent', x.surcharge_percent)
                            order by x.months), '[]'::jsonb)
    into v_result
  from (
    select distinct on (y.months) y.months, y.surcharge_percent
    from (
      select e.ord,
             case when jsonb_typeof(e.opt -> 'months') in ('number', 'string')
                   and (e.opt ->> 'months') ~ '^\s*[0-9]{1,3}(\.0+)?\s*$'
                  then btrim(e.opt ->> 'months')::numeric::integer end as months,
             case when jsonb_typeof(e.opt -> 'surcharge_percent') in ('number', 'string')
                   and (e.opt ->> 'surcharge_percent') ~ '^\s*[0-9]{1,3}(\.[0-9]+)?\s*$'
                  then btrim(e.opt ->> 'surcharge_percent')::numeric end as surcharge_percent
      from jsonb_array_elements(v_options) with ordinality as e(opt, ord)
      where jsonb_typeof(e.opt) = 'object'
    ) y
    where y.months between 1 and 120
      and y.surcharge_percent between 0 and 100
    order by y.months, y.ord
  ) x;

  return v_result;
end;
$$;

-- Prüft Token + PIN eines Portal-Links inkl. Widerruf, Ablauf und Fehlversuchs-Sperre.
-- Rückgabe: {ok:true, link_id, claim_id} oder {ok:false, code, error[, attempts_left]}.
-- Codes: link_invalid, link_revoked, link_expired, too_many_attempts, invalid_pin, link_locked.
-- Sperre: 5 Fehlversuche je 15 Minuten; nach 10 Fehlversuchen seit der letzten
-- erfolgreichen Anmeldung wird der Link endgültig gesperrt (is_active=false, revoked_at).
create or replace function public.claim_portal_check_access(p_token text, p_pin text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_link public.claim_access_links%rowtype;
  v_owner uuid;
  v_recent integer;
  v_since_success integer;
  c_window constant interval := interval '15 minutes';
  c_max_in_window constant integer := 5;
  c_max_total constant integer := 10;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'code', 'link_invalid',
      'error', 'Der Link ist ungültig. Bitte verwenden Sie den Link aus Ihrem Anschreiben.');
  end if;

  -- Zeilensperre: parallele Anmeldeversuche auf denselben Link laufen nacheinander,
  -- damit die Fehlversuchszählung nicht umgangen werden kann.
  select l.* into v_link
    from public.claim_access_links l
   where l.token = p_token
   order by l.created_at desc
   limit 1
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'link_invalid',
      'error', 'Der Link ist ungültig. Bitte verwenden Sie den Link aus Ihrem Anschreiben.');
  end if;

  if v_link.revoked_at is not null or v_link.is_active is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'link_revoked',
      'error', 'Dieser Link wurde widerrufen oder gesperrt. Bitte wenden Sie sich an Ihren Vermieter.');
  end if;

  if v_link.expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'link_expired',
      'error', 'Dieser Link ist abgelaufen. Bitte wenden Sie sich an Ihren Vermieter.');
  end if;

  select c.user_id into v_owner from public.claims c where c.id = v_link.claim_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'link_invalid',
      'error', 'Der Link ist ungültig. Bitte verwenden Sie den Link aus Ihrem Anschreiben.');
  end if;

  select count(*) filter (where e.event_date > clock_timestamp() - c_window),
         count(*) filter (where e.event_date > coalesce(v_link.last_used_at, v_link.created_at))
    into v_recent, v_since_success
    from public.claim_events e
   where e.claim_id = v_link.claim_id
     and e.event_type = 'note_added'
     and e.event_metadata ->> 'portal_event' = 'pin_failed'
     and e.event_metadata ->> 'link_id' = v_link.id::text;

  if v_recent >= c_max_in_window then
    return jsonb_build_object('ok', false, 'code', 'too_many_attempts',
      'error', 'Zu viele falsche Eingaben. Bitte warten Sie 15 Minuten und versuchen Sie es dann erneut.');
  end if;

  if p_pin is null or v_link.pin is null or v_link.pin <> btrim(p_pin) then
    insert into public.claim_events (user_id, claim_id, event_type, event_date, description, event_metadata)
    values (v_owner, v_link.claim_id, 'note_added', clock_timestamp(),
            'Mieterportal: falscher Zugangscode (PIN) eingegeben',
            jsonb_build_object('source', 'claim_portal', 'portal_event', 'pin_failed', 'link_id', v_link.id));

    v_recent := v_recent + 1;
    v_since_success := v_since_success + 1;

    if v_since_success >= c_max_total then
      update public.claim_access_links
         set is_active = false,
             revoked_at = coalesce(revoked_at, now())
       where id = v_link.id;

      insert into public.claim_events (user_id, claim_id, event_type, event_date, description, event_metadata)
      values (v_owner, v_link.claim_id, 'note_added', clock_timestamp(),
              'Mieterportal: Link nach zu vielen falschen PIN-Eingaben gesperrt. Bei Bedarf bitte einen neuen Portal-Link erstellen.',
              jsonb_build_object('source', 'claim_portal', 'portal_event', 'link_locked', 'link_id', v_link.id,
                                 'failed_attempts', v_since_success));

      return jsonb_build_object('ok', false, 'code', 'link_locked',
        'error', 'Der Link wurde nach zu vielen falschen Eingaben gesperrt. Bitte wenden Sie sich an Ihren Vermieter.');
    end if;

    return jsonb_build_object('ok', false, 'code', 'invalid_pin',
      'error', 'Der Zugangscode (PIN) ist nicht korrekt.',
      'attempts_left', least(c_max_in_window - v_recent, c_max_total - v_since_success));
  end if;

  update public.claim_access_links set last_used_at = clock_timestamp() where id = v_link.id;

  return jsonb_build_object('ok', true, 'link_id', v_link.id, 'claim_id', v_link.claim_id);
end;
$$;

-- Darf für diese Forderung über das Portal eine Ratenzahlung angefragt werden?
-- NULL = ja, sonst die (an den Mieter gerichtete) Begründung.
create or replace function public.claim_portal_plan_request_block_reason(p_claim_id uuid)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_owner uuid;
  v_allow boolean;
  v_options jsonb;
  v_total_due numeric;
begin
  select c.status, c.user_id into v_status, v_owner from public.claims c where c.id = p_claim_id;
  if not found then
    return 'Für diese Forderung ist derzeit keine Ratenzahlung möglich.';
  end if;

  if v_status in ('settled', 'cancelled', 'archived') then
    return 'Für diese Forderung ist keine Ratenzahlung mehr möglich.';
  end if;

  if v_status = 'payment_plan_active'
     or exists (select 1 from public.payment_plans pp where pp.claim_id = p_claim_id and pp.status = 'active') then
    return 'Für diese Forderung besteht bereits eine Ratenzahlungsvereinbarung.';
  end if;

  if exists (select 1 from public.payment_plan_requests r where r.claim_id = p_claim_id and r.status = 'requested') then
    return 'Es liegt bereits eine Anfrage zur Ratenzahlung vor. Ihr Vermieter wird sich bei Ihnen melden.';
  end if;

  -- 'payment_plan_requested' ohne offene Anfrage = Anfrage wurde abgelehnt -> neue Anfrage möglich
  if v_status not in ('draft', 'open', 'sent', 'action_required', 'payment_plan_requested') then
    return 'Für diese Forderung ist derzeit keine Ratenzahlung möglich.';
  end if;

  select coalesce(p.claim_portal_allow_installments, true),
         public.claim_portal_installment_options(p.claim_portal_installment_options)
    into v_allow, v_options
    from public.profiles p
   where p.id = v_owner;
  if not found then
    v_allow := true;
    v_options := public.claim_portal_installment_options(null);
  end if;

  if not v_allow or jsonb_array_length(v_options) = 0 then
    return 'Ihr Vermieter bietet für diese Forderung keine Ratenzahlung über das Portal an.';
  end if;

  select t.total_due into v_total_due from public.claim_totals_view t where t.claim_id = p_claim_id;
  if coalesce(v_total_due, 0) <= 0 then
    return 'Für diese Forderung ist kein offener Betrag vorhanden.';
  end if;

  return null;
end;
$$;


-- -----------------------------------------------------------------------------
-- 3. generate_claim_access_link: Anmeldung + Schreibrecht (finanzen) Pflicht,
--    Token/PIN bei Bedarf serverseitig, Gültigkeit 1-90 Tage
--    (Signatur und Rückgabetyp unverändert; ClaimDetail.jsx lädt den Link danach neu)
-- -----------------------------------------------------------------------------
create or replace function public.generate_claim_access_link(p_claim_id uuid, p_token text, p_pin text, p_expires_days integer default 14)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
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

  -- Token des Clients nur übernehmen, wenn lang genug, URL-tauglich und noch nicht vergeben
  if length(v_token) < 32 or length(v_token) > 128 or v_token !~ '^[A-Za-z0-9_-]+$'
     or exists (select 1 from public.claim_access_links l where l.token = v_token or l.token_hash = v_token) then
    v_token := encode(extensions.gen_random_bytes(16), 'hex');
  end if;

  -- PIN des Clients nur übernehmen, wenn 5-8 Ziffern, sonst 6-stellig zufällig erzeugen
  if v_pin !~ '^[0-9]{5,8}$' then
    v_bytes := extensions.gen_random_bytes(4);
    v_pin := (100000 + ((get_byte(v_bytes, 0)::bigint * 16777216
                         + get_byte(v_bytes, 1) * 65536
                         + get_byte(v_bytes, 2) * 256
                         + get_byte(v_bytes, 3)) % 900000))::text;
  end if;

  -- Nur ein aktiver Link je Forderung (auch per UI widerrufene Links sauber deaktivieren)
  update public.claim_access_links
     set is_active = false,
         revoked_at = coalesce(revoked_at, now())
   where claim_id = p_claim_id
     and (is_active is distinct from false or revoked_at is null);

  -- token/pin bleiben im Klartext (ClaimDetail.jsx zeigt Link und PIN an und druckt sie);
  -- die *_hash-Spalten enthalten jetzt echte Hashes statt einer Klartext-Kopie.
  insert into public.claim_access_links (claim_id, token, pin, token_hash, pin_hash, expires_at, created_by, is_active)
  values (p_claim_id,
          v_token,
          v_pin,
          encode(extensions.digest(v_token, 'sha256'), 'hex'),
          extensions.crypt(v_pin, extensions.gen_salt('bf')),
          now() + make_interval(days => v_days),
          v_uid,
          true)
  returning id into v_link_id;

  return v_link_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- 4. get_public_claim_by_token: Widerruf + Ablauf + Fehlversuchs-Sperre
--    (Antwort wie bisher, zusätzlich payment_plan_request_open/_allowed)
-- -----------------------------------------------------------------------------
create or replace function public.get_public_claim_by_token(p_token text, p_pin text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_access jsonb;
  v_claim public.claims%rowtype;
  v_allow boolean;
  v_options jsonb;
  v_request_open boolean;
  v_request_allowed boolean;
  v_result json;
begin
  v_access := public.claim_portal_check_access(p_token, p_pin);

  if not coalesce((v_access ->> 'ok')::boolean, false) then
    if v_access ->> 'code' in ('invalid_pin', 'link_locked') then
      -- Kein RAISE: der gezählte Fehlversuch (claim_events) muss gespeichert bleiben.
      return json_build_object(
        'error', v_access ->> 'error',
        'code', v_access ->> 'code',
        'attempts_left', v_access -> 'attempts_left');
    end if;
    raise exception using message = v_access ->> 'error', hint = v_access ->> 'code';
  end if;

  select * into v_claim from public.claims c where c.id = (v_access ->> 'claim_id')::uuid;

  -- Stornierte/archivierte Forderungen nicht anzeigen (erledigte schon, damit der Mieter den Stand sieht)
  if not found or v_claim.status in ('cancelled', 'archived') then
    raise exception using message = 'Diese Forderung ist bereits abgeschlossen oder storniert.', hint = 'claim_closed';
  end if;

  select coalesce(p.claim_portal_allow_installments, true),
         public.claim_portal_installment_options(p.claim_portal_installment_options)
    into v_allow, v_options
    from public.profiles p
   where p.id = v_claim.user_id;
  if not found then
    v_allow := true;
    v_options := public.claim_portal_installment_options(null);
  end if;

  v_request_open := exists (select 1 from public.payment_plan_requests r
                             where r.claim_id = v_claim.id and r.status = 'requested');
  v_request_allowed := public.claim_portal_plan_request_block_reason(v_claim.id) is null;

  select json_build_object(
      'claim_id', v_claim.id,
      'link_id', (v_access ->> 'link_id')::uuid,
      'status', v_claim.status,
      'deadline', v_claim.deadline,
      'interest_rate', v_claim.interest_rate,
      'accumulated_unpaid_fees', v_claim.accumulated_unpaid_fees,
      'accumulated_unpaid_interest', v_claim.accumulated_unpaid_interest,
      'tenant', (select json_build_object('first_name', t.first_name, 'last_name', t.last_name)
                   from public.tenants t where t.id = v_claim.tenant_id),
      'lease', (
          select json_build_object(
              'unit', (
                  select json_build_object(
                      'unit_name', u.unit_name,
                      'property', (select json_build_object('street', pr.street, 'house_number', pr.house_number,
                                                            'city', pr.city, 'zip', pr.zip)
                                     from public.properties pr where pr.id = u.property_id)
                  )
                  from public.units u where u.id = l.unit_id
              )
          ) from public.leases l where l.id = v_claim.lease_id
      ),
      'items', (
          select json_agg(json_build_object(
              'id', ci.id,
              'item_type', ci.item_type,
              'description', ci.description,
              'original_amount', ci.original_amount,
              'created_at', ci.created_at,
              'fee_amount', ci.fee_amount,
              'interest_amount', ci.interest_amount,
              'open_amount', cv.open_amount
          ))
          from public.claim_items ci
          left join public.claim_item_totals_view cv on cv.claim_item_id = ci.id
          where ci.claim_id = v_claim.id
      ),
      'totals', (
          select json_build_object(
              'total_due', tv.total_due,
              'current_principal_open', tv.current_principal_open,
              'total_fees_open', tv.total_fees_open,
              'total_interest_open', tv.total_interest_open
          )
          from public.claim_totals_view tv where tv.claim_id = v_claim.id
      ),
      'settings', json_build_object(
          'allow_installments', v_allow,
          'installment_options', v_options
      ),
      'payment_plan_request_open', v_request_open,
      'payment_plan_request_allowed', v_request_allowed,
      'bank_details', (
          select json_build_object(
              'account_holder', coalesce(p.bank_account_holder, ''),
              'iban', coalesce(p.iban, ''),
              'bic', coalesce(p.bic, '')
          )
          from public.profiles p where p.id = v_claim.user_id
      )
  ) into v_result;

  return v_result;
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. submit_public_payment_plan_request: Status-Whitelist, höchstens eine offene Anfrage,
--    Laufzeit nur aus den Optionen des Vermieters, Beträge serverseitig (Cent-genau),
--    Nachricht max. 2000 Zeichen. p_requested_rate/_total/p_adjustment_amount werden
--    ignoriert (Signatur bleibt für ältere App-Versionen).
-- -----------------------------------------------------------------------------
create or replace function public.submit_public_payment_plan_request(p_token text, p_pin text, p_requested_months integer, p_requested_rate numeric, p_requested_total numeric, p_adjustment_amount numeric, p_tenant_message text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_access jsonb;
  v_claim public.claims%rowtype;
  v_reason text;
  v_options jsonb;
  v_surcharge numeric;
  v_base numeric;
  v_adjustment numeric;
  v_total numeric;
  v_rate numeric;
  v_message text;
  c_max_message constant integer := 2000;
begin
  v_access := public.claim_portal_check_access(p_token, p_pin);

  if not coalesce((v_access ->> 'ok')::boolean, false) then
    if v_access ->> 'code' in ('invalid_pin', 'link_locked') then
      -- Kein RAISE: der gezählte Fehlversuch muss gespeichert bleiben.
      return json_build_object(
        'success', false,
        'error', v_access ->> 'error',
        'code', v_access ->> 'code',
        'attempts_left', v_access -> 'attempts_left');
    end if;
    raise exception using message = v_access ->> 'error', hint = v_access ->> 'code';
  end if;

  -- Forderung sperren: doppelte Anfragen (Doppelklick, parallele Aufrufe) laufen nacheinander
  select * into v_claim from public.claims c where c.id = (v_access ->> 'claim_id')::uuid for update;
  if not found then
    raise exception using message = 'Diese Forderung ist bereits abgeschlossen oder storniert.', hint = 'claim_closed';
  end if;

  v_reason := public.claim_portal_plan_request_block_reason(v_claim.id);
  if v_reason is not null then
    raise exception using message = v_reason, hint = 'request_not_allowed';
  end if;

  if p_requested_months is null then
    raise exception using message = 'Bitte wählen Sie eine der angebotenen Laufzeiten.', hint = 'invalid_option';
  end if;

  select public.claim_portal_installment_options(p.claim_portal_installment_options)
    into v_options
    from public.profiles p
   where p.id = v_claim.user_id;
  if not found then
    v_options := public.claim_portal_installment_options(null);
  end if;

  select (o ->> 'surcharge_percent')::numeric
    into v_surcharge
    from jsonb_array_elements(v_options) o
   where (o ->> 'months')::integer = p_requested_months
   limit 1;
  if not found then
    raise exception using message = 'Die gewählte Laufzeit wird nicht angeboten. Bitte wählen Sie eine der angebotenen Laufzeiten.',
                          hint = 'invalid_option';
  end if;

  v_message := nullif(btrim(coalesce(p_tenant_message, '')), '');
  if length(v_message) > c_max_message then
    raise exception using message = 'Die Nachricht darf höchstens 2000 Zeichen lang sein.', hint = 'message_too_long';
  end if;

  select round(coalesce(t.total_due, 0), 2) into v_base
    from public.claim_totals_view t
   where t.claim_id = v_claim.id;

  v_adjustment := round(v_base * v_surcharge / 100, 2);
  v_total := v_base + v_adjustment;
  v_rate := round(v_total / p_requested_months, 2);

  insert into public.payment_plan_requests (
      claim_id, access_link_id, requested_months, requested_rate, requested_total, adjustment_amount, tenant_message
  ) values (
      v_claim.id, (v_access ->> 'link_id')::uuid, p_requested_months, v_rate, v_total, v_adjustment, v_message
  );

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (
      v_claim.user_id,
      v_claim.id,
      'payment_plan_requested',
      'Mieter hat eine Ratenzahlung angefragt',
      jsonb_build_object(
          'requested_months', p_requested_months,
          'requested_rate', v_rate,
          'requested_total', v_total,
          'adjustment_amount', v_adjustment,
          'base_amount', v_base,
          'surcharge_percent', v_surcharge,
          'tenant_message', v_message,
          'previous_status', v_claim.status,
          'access_link_id', v_access ->> 'link_id'
      )
  );

  update public.claims set status = 'payment_plan_requested' where id = v_claim.id;

  return json_build_object(
      'success', true,
      'requested_months', p_requested_months,
      'requested_rate', v_rate,
      'requested_total', v_total,
      'adjustment_amount', v_adjustment);
end;
$$;


-- -----------------------------------------------------------------------------
-- 6. get_investor_properties: nur für das eigene Konto (bzw. freigegebene Objekte)
--    Aufruf in Policy user_roles.investors_manage_own_roles mit auth.uid() -> unverändert.
-- -----------------------------------------------------------------------------
create or replace function public.get_investor_properties(uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pr.id
    from public.properties pr
   where pr.user_id = uid
     and auth.uid() is not null
     and (uid = auth.uid() or public.has_property_access(pr.id, '*', 'read'));
$$;


-- -----------------------------------------------------------------------------
-- 7. Kontakt-/Mieter-Abgleich (Trigger-Funktionen; Trigger selbst unverändert)
-- -----------------------------------------------------------------------------

-- contacts -> tenants: nur eigener Mieter (tenants.user_id = contacts.user_id) und nur
-- tatsächlich geänderte Felder. Der Name wird nicht mehr bei jeder Änderung neu am ersten
-- Leerzeichen zerlegt; Straße/Hausnummer werden nur bei geänderter Straße neu getrennt.
create or replace function public.sync_contact_to_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_first text;
  v_last text;
  v_name text;
  v_tenant_first text;
  v_tenant_last text;
  v_street text;
  v_house text;
  v_matches text[];
  v_name_changed boolean;
  v_street_changed boolean;
begin
  -- Rekursionsschutz (tenants -> contacts -> tenants) bzw. kein Rückschreiben der
  -- Objektadresse aus sync_lease_to_contact in die Mieter-Stammdaten
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.contact_type is distinct from 'tenant' or new.tenant_id is null then
    return new;
  end if;

  -- Mandantenprüfung (D2-01): nur der Mieter desselben Vermieters
  select * into v_tenant from public.tenants t where t.id = new.tenant_id and t.user_id = new.user_id;
  if not found then
    return new;
  end if;

  v_name_changed := new.name is distinct from old.name;
  v_street_changed := new.street is distinct from old.street;

  if not (v_name_changed
          or v_street_changed
          or new.email is distinct from old.email
          or new.phone is distinct from old.phone
          or new.zip is distinct from old.zip
          or new.city is distinct from old.city) then
    return new;
  end if;

  -- Name
  v_first := v_tenant.first_name;
  v_last := v_tenant.last_name;
  if v_name_changed then
    v_name := btrim(coalesce(new.name, ''));
    v_tenant_first := btrim(coalesce(v_tenant.first_name, ''));
    v_tenant_last := btrim(coalesce(v_tenant.last_name, ''));

    if v_name = '' or v_name = btrim(v_tenant_first || ' ' || v_tenant_last) then
      null; -- nichts zu tun
    elsif v_tenant_first = '' then
      -- Mieter ohne Vornamen (z. B. Firma): gesamter Name bleibt Nachname
      v_last := v_name;
    elsif left(v_name, length(v_tenant_first) + 1) = v_tenant_first || ' ' then
      -- Vorname unverändert (auch Doppelvornamen), nur der Rest hat sich geändert
      v_first := v_tenant_first;
      v_last := btrim(substr(v_name, length(v_tenant_first) + 2));
    elsif v_tenant_last <> '' and length(v_name) > length(v_tenant_last) + 1
          and right(v_name, length(v_tenant_last) + 1) = ' ' || v_tenant_last then
      -- Nachname unverändert, nur der Vorname hat sich geändert
      v_last := v_tenant_last;
      v_first := btrim(left(v_name, length(v_name) - length(v_tenant_last) - 1));
    elsif position(' ' in v_name) > 0 then
      -- unbekannter neuer Name: bisherige Regel (erstes Leerzeichen)
      v_first := substr(v_name, 1, position(' ' in v_name) - 1);
      v_last := btrim(substr(v_name, position(' ' in v_name) + 1));
    else
      v_first := '';
      v_last := v_name;
    end if;
  end if;

  -- Straße / Hausnummer (D2-13): nur bei geänderter Straße; erkennt auch "12 a", "12-14", "12/2"
  v_street := v_tenant.street;
  v_house := v_tenant.house_number;
  if v_street_changed then
    if coalesce(btrim(new.street), '') = '' then
      v_street := '';
      v_house := '';
    else
      v_matches := regexp_match(btrim(new.street),
                                '^(.*?\S)\s+(\d+\s?[A-Za-z]?(?:\s?[-/]\s?\d*\s?[A-Za-z]?)*)$');
      if v_matches is not null then
        v_street := btrim(v_matches[1]);
        v_house := btrim(v_matches[2]);
      else
        v_street := btrim(new.street);
        v_house := '';
      end if;
    end if;
  end if;

  update public.tenants t
     set first_name   = v_first,
         last_name    = v_last,
         email        = case when new.email is distinct from old.email then new.email else t.email end,
         phone        = case when new.phone is distinct from old.phone then new.phone else t.phone end,
         street       = v_street,
         house_number = v_house,
         postal_code  = case when new.zip is distinct from old.zip then new.zip else t.postal_code end,
         city         = case when new.city is distinct from old.city then new.city else t.city end
   where t.id = v_tenant.id
     and t.user_id = new.user_id;

  return new;
end;
$$;

-- tenants -> contacts: nur Kontakte desselben Vermieters (D2-04); Objektadresse nur aus
-- Verträgen in Portfolios dieses Vermieters; kein Abbruch mehr bei fehlendem Vor-/Nachnamen.
create or replace function public.sync_tenant_to_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_street text;
  v_zip text;
  v_city text;
  v_unit_name text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_name := nullif(btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '');

  -- Adresse: eigene Mieteradresse, sonst Objektadresse des aktiven Vertrags
  if new.street is not null and new.street <> '' then
    v_street := btrim(coalesce(new.street, '') || ' ' || coalesce(new.house_number, ''));
    v_zip := new.postal_code;
    v_city := new.city;
  else
    select btrim(coalesce(p.street, '') || ' ' || coalesce(p.house_number, '')),
           p.zip,
           p.city,
           u.unit_name
      into v_street, v_zip, v_city, v_unit_name
      from public.leases l
      join public.units u on u.id = l.unit_id
      join public.properties p on p.id = u.property_id
      join public.portfolios po on po.id = p.portfolio_id
     where l.tenant_id = new.id
       and l.status = 'active'
       and po.user_id = new.user_id
     order by l.start_date desc
     limit 1;
  end if;

  if exists (select 1 from public.contacts c where c.tenant_id = new.id and c.user_id = new.user_id) then
    update public.contacts c
       set name      = coalesce(v_name, c.name),
           email     = new.email,
           phone     = new.phone,
           street    = coalesce(v_street, c.street),
           zip       = coalesce(v_zip, c.zip),
           city      = coalesce(v_city, c.city),
           unit_name = coalesce(v_unit_name, c.unit_name)
     where c.tenant_id = new.id
       and c.user_id = new.user_id;
  elsif v_name is not null then
    insert into public.contacts (user_id, name, contact_type, email, phone, street, zip, city, unit_name, tenant_id)
    values (new.user_id, v_name, 'tenant', new.email, new.phone, v_street, v_zip, v_city, v_unit_name, new.id);
  end if;

  return new;
end;
$$;

-- leases -> contacts: nur bei neuem Vertrag bzw. Wechsel von Einheit/Status/Mieter, nur wenn
-- Objekt-Eigentümer = Mieter-Eigentümer (D2-04), nur Kontakte dieses Vermieters. Die
-- Objektadresse ersetzt keine eigene Mieteradresse mehr (D2-12/M2-10), dann nur unit_name.
create or replace function public.sync_lease_to_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_owner uuid;
  v_tenant_street text;
  v_portfolio_owner uuid;
  v_street text;
  v_zip text;
  v_city text;
  v_unit_name text;
begin
  if new.status is distinct from 'active' or new.tenant_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.unit_id is not distinct from old.unit_id
     and new.status is not distinct from old.status
     and new.tenant_id is not distinct from old.tenant_id then
    return new;
  end if;

  select t.user_id, t.street into v_tenant_owner, v_tenant_street
    from public.tenants t where t.id = new.tenant_id;
  if not found then
    return new;
  end if;

  select btrim(coalesce(p.street, '') || ' ' || coalesce(p.house_number, '')),
         p.zip,
         p.city,
         u.unit_name,
         po.user_id
    into v_street, v_zip, v_city, v_unit_name, v_portfolio_owner
    from public.units u
    join public.properties p on p.id = u.property_id
    join public.portfolios po on po.id = p.portfolio_id
   where u.id = new.unit_id;

  if not found or v_portfolio_owner is distinct from v_tenant_owner then
    return new;
  end if;

  if coalesce(btrim(v_tenant_street), '') = '' then
    update public.contacts c
       set street = v_street,
           zip = v_zip,
           city = v_city,
           unit_name = v_unit_name
     where c.tenant_id = new.tenant_id
       and c.user_id = v_tenant_owner;
  else
    update public.contacts c
       set unit_name = v_unit_name
     where c.tenant_id = new.tenant_id
       and c.user_id = v_tenant_owner;
  end if;

  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- 8. Letzter Zählerstand: nur mit Schreibrecht auf den Zähler (D2-14/M1-09) und auch
--    bei Korrektur/Löschung einer Ablesung neu ermittelt (D2-19)
-- -----------------------------------------------------------------------------
create or replace function public.update_meter_last_reading()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_meter public.meters%rowtype;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_value numeric;
  v_date date;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select * into v_meter from public.meters m where m.id = new.meter_id;
    if found
       and v_uid is not null
       and v_meter.user_id is distinct from v_uid
       and not public.has_portfolio_access(v_meter.portfolio_id, 'zaehler', 'write') then
      raise exception 'Keine Berechtigung, für diesen Zähler einen Zählerstand zu erfassen.' using errcode = '42501';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_ids := array_append(v_ids, old.meter_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.meter_id is distinct from old.meter_id) then
    v_ids := array_append(v_ids, new.meter_id);
  end if;

  foreach v_id in array v_ids loop
    v_value := null;
    v_date := null;
    select r.reading_value, r.reading_date
      into v_value, v_date
      from public.meter_readings r
     where r.meter_id = v_id
     order by r.reading_date desc, r.created_at desc nulls last, r.id desc
     limit 1;

    update public.meters m
       set last_reading_value = v_value,
           last_reading_date = v_date,
           updated_at = now()
     where m.id = v_id
       and (m.last_reading_value is distinct from v_value or m.last_reading_date is distinct from v_date);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists on_reading_insert on public.meter_readings;
drop trigger if exists on_reading_change on public.meter_readings;
create trigger on_reading_change
  after insert or delete or update of meter_id, reading_value, reading_date on public.meter_readings
  for each row execute function public.update_meter_last_reading();


-- -----------------------------------------------------------------------------
-- 9. Fester search_path für die übrigen Funktionen ohne eigenes Paket
--    (nicht: notify_push; has_*-Ein-Parameter-Varianten gehören zum Fundament;
--     Funktionen anderer Pakete setzen ihren search_path selbst)
-- -----------------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.handle_updated_at()',
    'public.update_updated_at_column()',
    'public.update_document_templates_updated_at()',
    'public.trigger_push_on_announcement()',
    'public.trigger_push_on_document()',
    'public.trigger_push_on_message()',
    'public.trigger_push_on_registration()',
    'public.trigger_push_on_ticket()',
    'public.has_contact_access(uuid, uuid)',
    'public.has_document_template_access(uuid, uuid)'
  ] loop
    if to_regprocedure(v_sig) is not null then
      execute format('alter function %s set search_path = public, pg_temp', v_sig);
    end if;
  end loop;
end $$;
