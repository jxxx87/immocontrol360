-- =============================================================================
-- Paket MONEY-DB · Forderungen / Zahlungen / Ratenpläne (Komplett-Check 2026-11-27, Thema 4.10)
--
-- Befunde (Abschnitt 4.10 „sechs Geld-Fehler" + Paketliste):
--   1. Zinsen doppelt abgezogen ........ D1b-02, D4-01, H2-01, H4-02
--      -> Zinsformel steht nur noch in claim_interest_amount()/claim_live_interest();
--         claim_totals_view zieht interest_paid nicht mehr ab (Spalte ist netto).
--   2. Nachträge rückwirkend verzinst .. D1a-03, H3-02, R2-02, H4-04, H2-12 (Zinssatz)
--      -> Beim Anhängen werden die Zinsen der Altposten bis heute festgeschrieben und der
--         Zinsbeginn auf heute gesetzt (= Zinsbeginn je angehängtem Posten: Zinsen bis heute
--         je Posten ab Fälligkeit liefert die Oberfläche, ab heute läuft der gemeinsame
--         Zinsbeginn). Abweichender Zinssatz wird abgelehnt statt still verworfen.
--   3. Doppelte Anmahnung desselben Monats  D1a-04, H2-05, H3-01, H4-05 (G16-01 = Oberfläche)
--      -> Funktion und Trigger prüfen rent_ledger_id UND rent_ledger_ids; Mietzeilen werden
--         gesperrt (FOR UPDATE); Einzelmonat schreibt zusätzlich rent_ledger_id.
--   4. Ratenplan geht nicht auf ......... H2-03, H4-03, D1b-06, D1a-06, H2-11, D1a-14 (G15-02)
--      -> Aufschlag wird als Gebühr gebucht, Zinsen werden bei Plananlage festgeschrieben,
--         während des aktiven Plans laufen für Planpositionen keine Zinsen weiter, Raten
--         bedienen Gebühren -> Zinsen -> Hauptforderung, letzte Rate = Rest, Fälligkeiten
--         je Rate direkt berechnet, Eingaben geprüft.
--   5. Storno vertraut fremden Daten .... H1-01 (kritisch), D1b-04, H1-05, H4-11, H4-17,
--                                          D1b-14, H1-09, H4-10, R2-09
--      -> Zugriff auf die FORDERUNG wird geprüft, Raten/Pläne nur dieser Forderung,
--         Zinsstand wird per Differenz zurückgerechnet (auch für nicht-letzte Zahlungen),
--         Zahlung bleibt als 'cancelled' erhalten + Ereignis 'payment_reversed'.
--   6. Überzahlung verschwindet in 'fees'  H2-02, D1b-10
--      -> Rest wird auf weitere offene Posten verteilt; was nicht verteilbar ist, wird
--         abgelehnt. Kein stiller 'fees'-Ausgleich mehr.
--   Weitere: D1b-05, H1-02, H1-10 (Schutz forderungsgebundener Mietzahlungen),
--            D1b-09, H1-06, H4-07 (Zinsbeginn bei Zahlung), D1b-11, H4-09 (Positionsgebühren),
--            D1b-16 (Rundung), D1b-20, H1-17, H2-16, H3-13, H4-15 (Fehlermeldung %.2f),
--            D1b-22, H2-08, D1a-15 (einheitliche Berechtigung, Mitnutzer mit Schreibrecht
--            „finanzen"), H1-12 (Ratenplan rückgängig), H2-10 (Position löschen),
--            H2-07 (Erlass: Kennzeichnung + Status), H1-16, H3-10 (Eingabeprüfung),
--            H2-15 (Fälligkeit aus Mietkonto), D1a-13 (Rechnungsnummer),
--            D1a-10, H1-07, H1-08, H2-06, R2-08 (Schutz der Buchungshistorie, teilweise),
--            D1a-20 (NULL-sichere Integritätsprüfung).
--
-- Grundsätze
--   * Signaturen aller bestehenden Funktionen unverändert.
--   * Jede Forderungs-RPC prüft am Anfang: angemeldet (auth.uid() nicht NULL; Ausnahme
--     record_claim_payment für die Server-Rolle des Stripe-Webhooks) und Eigentümer der
--     Forderung oder has_claim_access(claim, 'finanzen', 'write').
--   * Alle Buchungen werden unter dem Eigentümer der Forderung (claims.user_id) gespeichert.
--   * Schreibschutz-Trigger lassen die RPCs über die transaktionslokale Einstellung
--     app.claims_rpc_bypass = '1' passieren (über PostgREST nicht setzbar).
--   * Keine automatische Datenkorrektur; Bestandsfälle: 100800_money_claims.analysis.sql.
--
-- Voraussetzung: 20261127100000_sec_access_helpers.sql
--   (has_claim_access/has_lease_access/has_portfolio_access mit 3 Parametern).
-- Idempotent (mehrfach ausführbar).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Hilfsfunktionen (Zinsformel an genau einer Stelle, Betragsformat)
-- -----------------------------------------------------------------------------

-- Einfache Verzugszinsen: Kapital x Satz (% p.a.) x Tage / 365, auf Cent gerundet.
create or replace function public.claim_interest_amount(p_principal numeric, p_rate numeric, p_from date, p_to date)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_principal is null or p_rate is null or p_from is null or p_to is null
      or p_principal <= 0 or p_rate <= 0 or p_to <= p_from
      then 0::numeric
    else round(p_principal * p_rate / 36500.0 * (p_to - p_from), 2)
  end
$$;

comment on function public.claim_interest_amount(numeric, numeric, date, date) is
  'Einzige Zinsformel des Forderungsmoduls: Kapital x Satz/100 x Tage/365, auf Cent gerundet.';

-- Seit claims.interest_start_date aufgelaufene, noch nicht festgeschriebene Zinsen zum
-- Stichtag p_as_of. Zinsbasis = offene Hauptforderung der Positionen, die NICHT von einem
-- aktiven Ratenplan erfasst sind (deren Zinsen stecken in der Plansumme).
-- SECURITY INVOKER: in der Sicht gelten die RLS-Regeln des Aufrufers.
create or replace function public.claim_live_interest(p_claim_id uuid, p_as_of date)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select public.claim_interest_amount(
             coalesce((
               select sum(greatest(0::numeric, ci.original_amount - coalesce(pd.paid, 0::numeric)))
                 from public.claim_items ci
                 left join lateral (
                   select sum(a.amount) as paid
                     from public.claim_payment_allocations a
                     join public.claim_payments cp on cp.id = a.claim_payment_id
                    where a.claim_item_id = ci.id
                      and a.allocation_bucket = 'principal'
                      and cp.status = 'posted'
                 ) pd on true
                where ci.claim_id = c.id
                  and not exists (
                    select 1 from public.payment_plans pl
                     where pl.claim_id = c.id
                       and pl.status = 'active'
                       and coalesce(ci.created_at, '-infinity'::timestamptz) <= pl.created_at)
             ), 0::numeric),
             c.interest_rate,
             c.interest_start_date,
             p_as_of)
      from public.claims c
     where c.id = p_claim_id
  ), 0::numeric)
$$;

comment on function public.claim_live_interest(uuid, date) is
  'Laufende Zinsen einer Forderung seit interest_start_date bis zum Stichtag (ohne Positionen eines aktiven Ratenplans).';

-- Betrag für Fehlermeldungen: 1234,56
create or replace function public.claim_format_eur(p_value numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(to_char(round(coalesce(p_value, 0), 2), 'FM9999999990.00'), '.', ',')
$$;


-- -----------------------------------------------------------------------------
-- 1. Forderungs-Summen: Zinsen nur noch einmal abziehen (D4-01, D1b-02, H2-01, H4-02)
--    accumulated_unpaid_interest ist NETTO (record_claim_payment mindert sie um den
--    gezahlten Zinsanteil) -> interest_paid wird in der Sicht nicht erneut abgezogen.
--    Spalten, Reihenfolge und Typen unverändert.
-- -----------------------------------------------------------------------------
create or replace view public.claim_totals_view
with (security_invoker = true)
as
 with allocation_sums as (
         select cp.claim_id,
            sum(cpa.amount) filter (where cpa.allocation_bucket = 'principal'::text) as principal_paid,
            sum(cpa.amount) filter (where cpa.allocation_bucket = 'fees'::text) as fees_paid,
            sum(cpa.amount) filter (where cpa.allocation_bucket = 'interest'::text) as interest_paid
           from public.claim_payments cp
             join public.claim_payment_allocations cpa on cp.id = cpa.claim_payment_id
          where cp.status = 'posted'::text
          group by cp.claim_id
        ), item_sums as (
         select claim_items.claim_id,
            sum(claim_items.original_amount) as original_principal
           from public.claim_items
          group by claim_items.claim_id
        )
 select c.id as claim_id,
    c.user_id,
    coalesce(i.original_principal, 0::numeric) as current_principal_original,
    coalesce(a.principal_paid, 0::numeric) as principal_paid,
    greatest(0::numeric, coalesce(i.original_principal, 0::numeric) - coalesce(a.principal_paid, 0::numeric)) as current_principal_open,
    c.accumulated_unpaid_fees,
    coalesce(a.fees_paid, 0::numeric) as fees_paid,
    greatest(0::numeric, c.accumulated_unpaid_fees - coalesce(a.fees_paid, 0::numeric)) as total_fees_open,
    c.accumulated_unpaid_interest,
    coalesce(a.interest_paid, 0::numeric) as interest_paid,
    li.live_interest as live_interest_since_start,
    greatest(0::numeric, c.accumulated_unpaid_interest + li.live_interest) as total_interest_open,
    greatest(0::numeric, coalesce(i.original_principal, 0::numeric) - coalesce(a.principal_paid, 0::numeric))
      + greatest(0::numeric, c.accumulated_unpaid_fees - coalesce(a.fees_paid, 0::numeric))
      + greatest(0::numeric, c.accumulated_unpaid_interest + li.live_interest) as total_due
   from public.claims c
     left join item_sums i on c.id = i.claim_id
     left join allocation_sums a on c.id = a.claim_id
     cross join lateral (
       select coalesce(public.claim_live_interest(c.id, current_date), 0::numeric) as live_interest
     ) li;


-- -----------------------------------------------------------------------------
-- 2. Integritäts- und Schutz-Trigger
-- -----------------------------------------------------------------------------

-- 2a. Doppelte Anmahnung: Einzelfeld UND Listenfeld prüfen (D1a-04, H2-05, H3-01, H4-05)
create or replace function public.check_duplicate_active_claim_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ids uuid[];
  v_dup uuid;
  v_dup_period date;
begin
  -- Bei UPDATE nur prüfen, wenn sich die Mietzuordnung ändert (Altbestand bleibt bearbeitbar)
  if tg_op = 'UPDATE'
     and new.rent_ledger_id is not distinct from old.rent_ledger_id
     and new.rent_ledger_ids is not distinct from old.rent_ledger_ids
     and new.claim_id is not distinct from old.claim_id then
    return new;
  end if;

  v_ids := array(
    select distinct x
      from unnest(array_append(coalesce(new.rent_ledger_ids, '{}'::uuid[]), new.rent_ledger_id)) as t(x)
     where x is not null);

  if cardinality(v_ids) = 0 then
    return new;
  end if;

  select x into v_dup
    from unnest(v_ids) as t(x)
   where exists (
     select 1
       from public.claim_items ci
       join public.claims c on c.id = ci.claim_id
      where ci.id <> new.id
        and c.status not in ('cancelled', 'archived', 'settled')
        and (ci.rent_ledger_id = t.x or t.x = any(ci.rent_ledger_ids)))
   limit 1;

  if v_dup is not null then
    select period_month into v_dup_period from public.rent_ledger where id = v_dup;
    raise exception 'Für die Miete % existiert bereits eine aktive Forderung.',
      coalesce(to_char(v_dup_period, 'MM/YYYY'), v_dup::text);
  end if;

  return new;
end;
$function$;

-- 2b. Mietzeilen und Forderung einer Position gehören dem Eigentümer der Position
create or replace function public.check_claim_item_rent_ledger_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'INSERT'
     or new.claim_id is distinct from old.claim_id
     or new.user_id is distinct from old.user_id then
    if not exists (select 1 from public.claims c where c.id = new.claim_id and c.user_id = new.user_id) then
      raise exception 'claim_id gehört nicht zum Eigentümer der Position.';
    end if;
  end if;

  if new.rent_ledger_id is not null
     and (tg_op = 'INSERT' or new.rent_ledger_id is distinct from old.rent_ledger_id or new.user_id is distinct from old.user_id) then
    if not exists (select 1 from public.rent_ledger where id = new.rent_ledger_id and user_id = new.user_id) then
      raise exception 'rent_ledger_id does not belong to the user.';
    end if;
  end if;

  if new.rent_ledger_ids is not null
     and (tg_op = 'INSERT' or new.rent_ledger_ids is distinct from old.rent_ledger_ids or new.user_id is distinct from old.user_id) then
    if exists (
      select 1 from unnest(new.rent_ledger_ids) as t(x)
       where x is null
          or not exists (select 1 from public.rent_ledger r where r.id = t.x and r.user_id = new.user_id)) then
      raise exception 'rent_ledger_ids gehören nicht zum Nutzer.';
    end if;
  end if;

  return new;
end;
$function$;

-- 2c. Zahlung gehört zur Forderung ihres Eigentümers (H1-01: keine Zahlungen mit fremder claim_id)
create or replace function public.check_claim_payment_rent_payment_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'INSERT'
     or new.claim_id is distinct from old.claim_id
     or new.user_id is distinct from old.user_id then
    if not exists (select 1 from public.claims c where c.id = new.claim_id and c.user_id = new.user_id) then
      raise exception 'claim_id gehört nicht zum Eigentümer der Zahlung.';
    end if;
  end if;

  if new.rent_payment_id is not null
     and (tg_op = 'INSERT' or new.rent_payment_id is distinct from old.rent_payment_id or new.user_id is distinct from old.user_id) then
    if not exists (select 1 from public.rent_payments where id = new.rent_payment_id and user_id = new.user_id) then
      raise exception 'rent_payment_id does not belong to the user.';
    end if;
  end if;

  return new;
end;
$function$;

-- 2d. Ereignis gehört zu einer Forderung, auf die der Schreibende Zugriff hat (H1-01)
create or replace function public.check_claim_event_document_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'INSERT'
     or new.claim_id is distinct from old.claim_id
     or new.user_id is distinct from old.user_id then
    if not exists (
      select 1 from public.claims c
       where c.id = new.claim_id
         and (c.user_id = new.user_id or public.has_claim_access(new.claim_id, '*', 'read'))) then
      raise exception 'claim_id gehört nicht zum Nutzer.';
    end if;
  end if;

  if new.document_id is not null then
    if not exists (select 1 from public.documents where id = new.document_id and user_id = new.user_id) then
      raise exception 'document_id does not belong to the user.';
    end if;
  end if;
  return new;
end;
$function$;

-- 2e. NULL-sichere Zuordnungsprüfung (D1a-20)
create or replace function public.check_claim_allocation_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_payment_user_id uuid;
  v_payment_claim_id uuid;
  v_payment_allocation_type text;
  v_payment_status text;
  v_claim_user_id uuid;
  v_item_user_id uuid;
  v_item_claim_id uuid;
begin
  -- 1. Zahlung existiert und gehört zu Nutzer und Forderung
  select user_id, claim_id, allocation_type, status
    into v_payment_user_id, v_payment_claim_id, v_payment_allocation_type, v_payment_status
    from public.claim_payments where id = new.claim_payment_id;
  if not found then
    raise exception 'claim_payment_id does not exist.';
  end if;
  if v_payment_user_id is distinct from new.user_id then
    raise exception 'claim_payment_id does not belong to the user.';
  end if;
  if v_payment_claim_id is distinct from new.claim_id then
    raise exception 'claim_id does not match the claim_payment claim_id.';
  end if;
  if tg_op = 'INSERT' and v_payment_status = 'cancelled' then
    raise exception 'Stornierte Zahlungen können keine neuen Zuordnungen erhalten.';
  end if;

  -- Vorzeichen-Check
  if new.amount > 0 and v_payment_allocation_type = 'reversal' then
    raise exception 'Reversal allocations must be negative or zero.';
  end if;
  if new.amount < 0 and v_payment_allocation_type is distinct from 'reversal' then
    raise exception 'Normal allocations must be positive or zero.';
  end if;

  -- 2. Forderung gehört dem Nutzer
  select user_id into v_claim_user_id from public.claims where id = new.claim_id;
  if not found or v_claim_user_id is distinct from new.user_id then
    raise exception 'claim_id does not belong to the user.';
  end if;

  -- 3. Position (falls angegeben) gehört zu Nutzer und Forderung
  if new.claim_item_id is not null then
    select user_id, claim_id into v_item_user_id, v_item_claim_id
      from public.claim_items where id = new.claim_item_id;
    if not found or v_item_user_id is distinct from new.user_id then
      raise exception 'claim_item_id does not belong to the user.';
    end if;
    if v_item_claim_id is distinct from new.claim_id then
      raise exception 'claim_item_id does not belong to this claim.';
    end if;
  end if;

  return new;
end;
$function$;

-- 2f. Gebuchte/stornierte Zahlungen nur über die RPCs ändern
create or replace function public.block_posted_payment_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if current_setting('app.claims_rpc_bypass', true) = '1' then
    return new;
  end if;
  if old.status in ('posted', 'cancelled') then
    raise exception 'Gebuchte oder stornierte Zahlungen können nicht geändert werden. Bitte die Zahlung in der Forderungsakte stornieren.';
  end if;
  return new;
end;
$function$;

create or replace function public.block_posted_allocation_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_status text;
begin
  if current_setting('app.claims_rpc_bypass', true) = '1' then
    return new;
  end if;
  select status into v_status from public.claim_payments where id = old.claim_payment_id;
  if v_status in ('posted', 'cancelled') then
    raise exception 'Allocations for posted payments cannot be modified.';
  end if;
  return new;
end;
$function$;

-- 2g. Löschschutz Zahlungen/Zuordnungen, Schreibschutz Ratenpläne (H1-08, H2-06)
create or replace function public.protect_claim_payment_records()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if current_setting('app.claims_rpc_bypass', true) = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'claim_payments' then
    if tg_op = 'DELETE' and old.status in ('posted', 'cancelled') then
      raise exception 'Gebuchte Zahlungen können nicht gelöscht werden. Bitte die Zahlung in der Forderungsakte stornieren.';
    end if;
  elsif tg_table_name = 'claim_payment_allocations' then
    if tg_op = 'DELETE' and exists (
         select 1 from public.claim_payments cp
          where cp.id = old.claim_payment_id and cp.status in ('posted', 'cancelled')) then
      raise exception 'Zuordnungen gebuchter Zahlungen können nicht gelöscht werden. Bitte die Zahlung in der Forderungsakte stornieren.';
    end if;
  elsif tg_table_name in ('payment_plans', 'payment_plan_installments') then
    -- Erlaubt bleibt die reine Stornierung (Forderung stornieren in Claims.jsx: offene Raten
    -- und aktiven Plan auf 'cancelled'); dabei ändern sich nur Status und Storno-Angaben.
    if tg_op = 'UPDATE' and new.status = 'cancelled' then
      if tg_table_name = 'payment_plans' then
        if old.status = 'active'
           and (to_jsonb(new) - array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at'])
             = (to_jsonb(old) - array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']) then
          return new;
        end if;
      elsif old.status in ('open', 'partial', 'overdue')
            and (to_jsonb(new) - array['status', 'updated_at', 'open_amount'])
              = (to_jsonb(old) - array['status', 'updated_at', 'open_amount']) then
        return new;
      end if;
    end if;
    raise exception 'Ratenpläne können nur über die Forderungsakte angelegt, gebucht oder rückgängig gemacht werden.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists trigger_protect_claim_payments_delete on public.claim_payments;
create trigger trigger_protect_claim_payments_delete
  before delete on public.claim_payments
  for each row execute function public.protect_claim_payment_records();

drop trigger if exists trigger_protect_claim_allocations_delete on public.claim_payment_allocations;
create trigger trigger_protect_claim_allocations_delete
  before delete on public.claim_payment_allocations
  for each row execute function public.protect_claim_payment_records();

drop trigger if exists trigger_protect_payment_plans on public.payment_plans;
create trigger trigger_protect_payment_plans
  before insert or update or delete on public.payment_plans
  for each row execute function public.protect_claim_payment_records();

drop trigger if exists trigger_protect_payment_plan_installments on public.payment_plan_installments;
create trigger trigger_protect_payment_plan_installments
  before insert or update or delete on public.payment_plan_installments
  for each row execute function public.protect_claim_payment_records();

-- 2h. Forderungen nicht physisch löschen (H2-06: Trigger block_claims_delete hing an einem No-op)
create or replace function public.block_physical_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if current_setting('app.claims_rpc_bypass', true) = '1' then
    return old;
  end if;
  raise exception 'Forderungen können nicht gelöscht werden. Bitte stornieren oder archivieren.';
end;
$function$;

-- 2i. Buchungsrelevante Ereignisse schützen (D1a-10, H1-07, R2-08 – teilweise).
--     UPDATE: Ereignisse, deren Metadaten Stornos steuern, sind unveränderlich.
--     DELETE: Storno-Ereignisse nie; Zahlungsereignis erst nach Storno der Zahlung;
--             Ratenplan-Ereignis erst nach Rückgängigmachen des Plans.
--     Notizen, Mahnungen, Fristen bleiben änderbar/löschbar (App nutzt das).
create or replace function public.block_claim_events_modification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if current_setting('app.claims_rpc_bypass', true) = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.event_type in ('created', 'payment_received', 'payment_reversed', 'payment_plan_accepted')
       or new.event_type in ('created', 'payment_received', 'payment_reversed', 'payment_plan_accepted')
       or (old.event_type = 'note_added' and coalesce(old.event_metadata->>'source', '') <> '')
       or new.claim_id is distinct from old.claim_id then
      raise exception 'Buchungsrelevante Ereignisse der Forderungsakte können nicht geändert werden.';
    end if;
    return new;
  end if;

  -- DELETE
  if old.event_type = 'payment_reversed' then
    raise exception 'Storno-Ereignisse sind Teil des Zahlungsnachweises und können nicht gelöscht werden.';
  end if;
  if old.event_type = 'payment_received'
     and exists (select 1 from public.claim_payments cp
                  where cp.id::text = old.event_metadata->>'payment_id' and cp.status = 'posted') then
    raise exception 'Diese Zahlung ist noch gebucht. Bitte die Zahlung zuerst stornieren.';
  end if;
  if old.event_type = 'payment_plan_accepted'
     and exists (select 1 from public.payment_plans pp
                  where pp.id::text = old.event_metadata->>'payment_plan_id' and pp.status = 'active') then
    raise exception 'Der Ratenplan ist noch aktiv. Bitte den Ratenplan zuerst rückgängig machen.';
  end if;
  return old;
end;
$function$;

drop trigger if exists trigger_protect_claim_events on public.claim_events;
create trigger trigger_protect_claim_events
  before update or delete on public.claim_events
  for each row execute function public.block_claim_events_modification();

-- 2j. Forderungsgebundene Mietzahlungen (D1b-05, H1-02, H1-10)
--     Erkannt an „Verrechnung … Forderungsakte (Ref: <Zahlungs-ID>)" (alte und neue Schreibweise);
--     geschützt, solange die referenzierte Forderungszahlung gebucht ist. Verwaiste Zeilen
--     (Zahlung gibt es nicht mehr) bleiben löschbar. Betrag, Notiz, Vertrag, Monat und
--     Eigentümer sind nicht änderbar (sonst ginge die Verknüpfung verloren).
create or replace function public.protect_claim_rent_payments()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ref text;
  v_linked boolean := false;
begin
  -- Ausnahme innerhalb von reverse_claim_payment
  if current_setting('app.bypass_rent_payment_protect', true) = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if old.note is not null and old.note like '%Verrechnung%Forderungsakte%' then
    v_ref := substring(old.note from '\(Ref: ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)');
    if v_ref is not null then
      v_linked := exists (select 1 from public.claim_payments cp where cp.id = v_ref::uuid and cp.status = 'posted');
    end if;
  end if;

  if not v_linked then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Diese Zahlung ist an eine Forderungsakte geknüpft. Bitte löschen Sie die Zahlung direkt in der Timeline der jeweiligen Forderung.';
  end if;

  if new.amount is distinct from old.amount
     or new.note is distinct from old.note
     or new.lease_id is distinct from old.lease_id
     or new.period_month is distinct from old.period_month
     or new.user_id is distinct from old.user_id then
    raise exception 'Eine forderungsgebundene Zahlung kann nicht manuell in der Buchhaltung geändert werden. Bitte stornieren Sie die Zahlung in der zugehörigen Forderungsakte.';
  end if;
  return new;
end;
$function$;


-- -----------------------------------------------------------------------------
-- 3. create_claim_advanced
--    D1a-03, H3-02, R2-02, H4-04 (Nachtrag: Zinsen festschreiben, Zinsbeginn = heute),
--    H2-12 (abweichender Zinssatz), D1a-04/H2-05/H3-01/H4-05 (Doppelprüfung beider Felder),
--    H1-16/H3-10 (Eingabeprüfung), D1a-15 (neutrale Meldung, Mitnutzer „finanzen"/write),
--    H2-15 (Fälligkeit der Mietposition aus dem Mietkonto)
-- -----------------------------------------------------------------------------
create or replace function public.create_claim_advanced(
  p_lease_id uuid,
  p_rent_ledger_ids uuid[],
  p_manual_items jsonb,
  p_fee_amount numeric,
  p_interest_rate numeric,
  p_accumulated_interest numeric,
  p_interest_start_date date,
  p_deadline_days integer,
  p_note text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_tenant_id uuid;
  v_lease_found boolean;
  v_ledger_ids uuid[];
  v_sorted_ids uuid[] := '{}'::uuid[];
  v_manual jsonb;
  v_parsed jsonb := '[]'::jsonb;
  v_m jsonb;
  v_ledger record;
  v_found integer := 0;
  v_open numeric;
  v_rent_total numeric := 0;
  v_manual_total numeric := 0;
  v_first_period date;
  v_first_due date;
  v_dup uuid;
  v_active public.claims%rowtype;
  v_has_active boolean := false;
  v_claim_id uuid;
  v_deadline date;
  v_fee numeric;
  v_interest numeric;
  v_rate numeric;
  v_cap numeric := 0;
  v_metadata_items jsonb := '[]'::jsonb;
  v_desc_text text := '';
  v_desc_rent text := '';
  v_item_desc text;
  v_item_amount numeric;
  v_item_type text;
  v_item_due date;
  v_is_first boolean := true;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  -- Mietvertrag + Berechtigung (Eigentümer oder Schreibrecht „finanzen")
  select true, l.tenant_id, l.user_id
    into v_lease_found, v_tenant_id, v_owner
    from public.leases l where l.id = p_lease_id;
  if not coalesce(v_lease_found, false)
     or (v_owner <> v_caller and not public.has_lease_access(p_lease_id, 'finanzen', 'write')) then
    raise exception 'Mietvertrag nicht gefunden oder keine Berechtigung.';
  end if;

  if v_tenant_id is null then
    raise exception 'Fehler: Diesem Mietvertrag ist kein Mieter zugewiesen! Bitte weisen Sie dem Mietvertrag einen Mieter zu, bevor Sie eine Forderung erstellen.';
  end if;

  -- Eingaben normalisieren und prüfen
  v_ledger_ids := array(select distinct x from unnest(coalesce(p_rent_ledger_ids, '{}'::uuid[])) as t(x) where x is not null);
  v_manual := coalesce(p_manual_items, '[]'::jsonb);
  if jsonb_typeof(v_manual) <> 'array' then
    raise exception 'Ungültige manuelle Positionen.';
  end if;
  if cardinality(v_ledger_ids) = 0 and jsonb_array_length(v_manual) = 0 then
    raise exception 'Keine Forderungspositionen angegeben.';
  end if;

  v_fee := round(coalesce(p_fee_amount, 0), 2);
  v_interest := round(coalesce(p_accumulated_interest, 0), 2);
  v_rate := coalesce(p_interest_rate, 0);
  if v_fee < 0 then
    raise exception 'Die Mahngebühr darf nicht negativ sein.';
  end if;
  if v_interest < 0 then
    raise exception 'Die aufgelaufenen Zinsen dürfen nicht negativ sein.';
  end if;
  if v_rate < 0 or v_rate > 100 then
    raise exception 'Ungültiger Zinssatz.';
  end if;
  if p_deadline_days is not null and (p_deadline_days < 0 or p_deadline_days > 365) then
    raise exception 'Die Frist muss zwischen 0 und 365 Tagen liegen.';
  end if;

  -- Mieten: sperren, Zugehörigkeit, Offenstand und Doppelanmahnung prüfen
  if cardinality(v_ledger_ids) > 0 then
    for v_ledger in
      select id, lease_id, expected_rent, coalesce(paid_amount, 0) as paid_amount, period_month, due_date
        from public.rent_ledger
       where id = any(v_ledger_ids) and user_id = v_owner
       order by period_month
         for update
    loop
      v_found := v_found + 1;
      if v_ledger.lease_id <> p_lease_id then
        raise exception 'Alle ausgewählten Mieten müssen zum selben Mietvertrag gehören.';
      end if;
      v_open := round(v_ledger.expected_rent - v_ledger.paid_amount, 2);
      if v_open <= 0 then
        raise exception 'Die Miete % ist bereits bezahlt.', to_char(v_ledger.period_month, 'MM/YYYY');
      end if;

      select ci.claim_id into v_dup
        from public.claim_items ci
        join public.claims c on c.id = ci.claim_id
       where (ci.rent_ledger_id = v_ledger.id or v_ledger.id = any(ci.rent_ledger_ids))
         and c.status not in ('settled', 'cancelled', 'archived')
       limit 1;
      if v_dup is not null then
        raise exception 'Für die Miete % existiert bereits eine aktive Forderung.', to_char(v_ledger.period_month, 'MM/YYYY');
      end if;

      v_rent_total := v_rent_total + v_open;
      v_sorted_ids := array_append(v_sorted_ids, v_ledger.id);
      if v_first_period is null then
        v_first_period := v_ledger.period_month;
        v_first_due := v_ledger.due_date;
      end if;
      v_desc_rent := v_desc_rent || to_char(v_ledger.period_month, 'MM/YYYY') || ', ';
      v_metadata_items := v_metadata_items || jsonb_build_array(jsonb_build_object(
        'rent_ledger_id', v_ledger.id, 'period_month', v_ledger.period_month,
        'amount', v_open, 'description', 'Mietrückstand ' || to_char(v_ledger.period_month, 'MM/YYYY')));
    end loop;

    if v_found <> cardinality(v_ledger_ids) then
      raise exception 'Mindestens eine ausgewählte Miete wurde nicht gefunden oder gehört nicht zu diesem Mietvertrag.';
    end if;

    if cardinality(v_ledger_ids) = 1 then
      v_desc_text := v_desc_text || 'Mietrückstand ' || substring(v_desc_rent from 1 for length(v_desc_rent) - 2) || ', ';
    else
      v_desc_text := v_desc_text || 'Mietrückstände ' || substring(v_desc_rent from 1 for length(v_desc_rent) - 2) || ', ';
    end if;
  end if;

  -- Manuelle Positionen: Betrag > 0, gültiger Typ und Fälligkeit
  for v_m in select value from jsonb_array_elements(v_manual)
  loop
    if jsonb_typeof(v_m) <> 'object' then
      raise exception 'Ungültige manuelle Position.';
    end if;
    v_item_desc := nullif(trim(coalesce(v_m->>'description', '')), '');
    begin
      v_item_amount := round(nullif(trim(coalesce(v_m->>'amount', '')), '')::numeric, 2);
    exception when others then
      raise exception 'Manuelle Position "%": ungültiger Betrag.', coalesce(v_item_desc, '');
    end;
    if v_item_amount is null or v_item_amount <= 0 then
      raise exception 'Manuelle Position "%": Der Betrag muss größer als 0 sein.', coalesce(v_item_desc, '');
    end if;
    v_item_type := coalesce(nullif(v_m->>'item_type', ''), 'other');
    if v_item_type not in ('rent', 'utility_backpay', 'damage', 'deposit', 'other') then
      raise exception 'Manuelle Position "%": unbekannter Positionstyp.', coalesce(v_item_desc, '');
    end if;
    begin
      v_item_due := nullif(trim(coalesce(v_m->>'dueDate', '')), '')::date;
    exception when others then
      raise exception 'Manuelle Position "%": ungültiges Fälligkeitsdatum.', coalesce(v_item_desc, '');
    end;

    v_manual_total := v_manual_total + v_item_amount;
    v_desc_text := v_desc_text || coalesce(v_item_desc, 'Position') || ', ';
    v_parsed := v_parsed || jsonb_build_array(jsonb_build_object(
      'description', v_item_desc, 'amount', v_item_amount, 'item_type', v_item_type, 'due_date', v_item_due));
    v_metadata_items := v_metadata_items || jsonb_build_array(jsonb_build_object(
      'description', v_item_desc, 'amount', v_item_amount, 'item_type', v_item_type, 'due_date', v_item_due));
  end loop;

  if length(v_desc_text) > 0 then
    v_desc_text := substring(v_desc_text from 1 for length(v_desc_text) - 2);
  end if;
  v_deadline := case when p_deadline_days is null then null else current_date + p_deadline_days end;

  -- Aktive Forderung zum Mietvertrag?
  select * into v_active
    from public.claims
   where lease_id = p_lease_id and user_id = v_owner
     and status not in ('settled', 'cancelled', 'archived')
   order by created_at desc
   limit 1
     for update;
  v_has_active := found;

  if v_has_active then
    v_claim_id := v_active.id;

    -- Zinssatz muss zur bestehenden Forderung passen (H2-12, H3-02)
    if v_active.interest_start_date is null then
      if v_rate > 0 or v_interest > 0 then
        raise exception 'Die bestehende Forderung zu diesem Mietvertrag ist unverzinst. Bitte die neuen Positionen ohne Zinsen erfassen oder die bestehende Forderung zuerst abschließen.';
      end if;
    elsif abs(coalesce(v_active.interest_rate, 0) - v_rate) > 0.00005 then
      raise exception 'Die bestehende Forderung zu diesem Mietvertrag wird mit % %% verzinst. Bitte denselben Zinssatz verwenden oder die bestehende Forderung zuerst abschließen.',
        replace(trim_scale(coalesce(v_active.interest_rate, 0))::text, '.', ',');
    end if;

    -- Zinsen der bisherigen Posten bis heute festschreiben, Zinsbeginn = heute.
    -- Die Zinsen der neuen Posten bis heute übergibt die Oberfläche (p_accumulated_interest).
    v_cap := coalesce(public.claim_live_interest(v_claim_id, current_date), 0);

    update public.claims set
      accumulated_unpaid_interest = round(coalesce(accumulated_unpaid_interest, 0) + v_cap + v_interest, 2),
      accumulated_unpaid_fees = coalesce(accumulated_unpaid_fees, 0) + v_fee,
      interest_start_date = case when interest_start_date is null then null
                                 else greatest(interest_start_date, current_date) end,
      deadline = greatest(deadline, v_deadline),
      next_action_at = greatest(next_action_at, v_deadline),
      updated_at = now()
    where id = v_claim_id;
  else
    insert into public.claims (user_id, lease_id, tenant_id, status, escalation_level,
        interest_start_date, interest_rate, accumulated_unpaid_interest, accumulated_unpaid_fees,
        deadline, next_action_at)
    values (v_owner, p_lease_id, v_tenant_id, 'open', 0,
        p_interest_start_date, v_rate, v_interest, v_fee,
        v_deadline, v_deadline)
    returning id into v_claim_id;
  end if;

  -- Mieten als EINE Position (Einzelmonat zusätzlich im Einzelfeld rent_ledger_id)
  if cardinality(v_sorted_ids) > 0 then
    insert into public.claim_items (
        user_id, claim_id, item_type, original_amount, period_month,
        description, due_date, rent_ledger_id, rent_ledger_ids, fee_amount, interest_amount)
    values (
        v_owner, v_claim_id, 'rent', v_rent_total, v_first_period,
        case when cardinality(v_sorted_ids) = 1 then 'Mietrückstand ' else 'Mietrückstände ' end
          || substring(v_desc_rent from 1 for length(v_desc_rent) - 2),
        coalesce(v_first_due, v_first_period + 3),
        case when cardinality(v_sorted_ids) = 1 then v_sorted_ids[1] else null end,
        v_sorted_ids, v_fee, v_interest);
    v_is_first := false;
  end if;

  -- Manuelle Positionen
  for v_m in select value from jsonb_array_elements(v_parsed)
  loop
    insert into public.claim_items (user_id, claim_id, item_type, original_amount, description, due_date, fee_amount, interest_amount)
    values (v_owner, v_claim_id, v_m->>'item_type', (v_m->>'amount')::numeric, v_m->>'description',
            nullif(v_m->>'due_date', '')::date,
            case when v_is_first then v_fee else 0 end,
            case when v_is_first then v_interest else 0 end);
    v_is_first := false;
  end loop;

  -- Ereignis
  if v_has_active then
    insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
    values (v_caller, v_claim_id, 'note_added', 'Forderungspositionen hinzugefügt: ' || v_desc_text,
        jsonb_build_object('source', 'append_advanced', 'items', v_metadata_items,
            'total_principal_amount', v_rent_total + v_manual_total, 'fee_amount', v_fee,
            'accumulated_interest', v_interest, 'capitalized_interest', v_cap,
            'old_interest_start_date', v_active.interest_start_date,
            'interest_rate', v_rate, 'note', p_note));
  else
    insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
    values (v_caller, v_claim_id, 'created', 'Forderung erstellt: ' || v_desc_text,
        jsonb_build_object('source', 'create_advanced', 'items', v_metadata_items,
            'total_principal_amount', v_rent_total + v_manual_total, 'fee_amount', v_fee,
            'accumulated_interest', v_interest, 'interest_start_date', p_interest_start_date,
            'interest_rate', v_rate, 'deadline', v_deadline, 'note', p_note));
  end if;

  return v_claim_id;
end;
$function$;


-- -----------------------------------------------------------------------------
-- 4. create_payment_plan
--    H2-03, H4-03, D1b-06 (Aufschlag als Gebühr; Zinsen festschreiben),
--    D1a-06, H2-11 (Eingabeprüfung, letzte Rate > 0), D1a-14 (Fälligkeiten je Rate)
-- -----------------------------------------------------------------------------
create or replace function public.create_payment_plan(
  p_claim_id uuid,
  p_first_due_date date,
  p_installment_count integer,
  p_adjustment_amount numeric,
  p_note text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_caller uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_adj numeric;
  v_cap numeric := 0;
  v_fees_before numeric;
  v_interest_after numeric;
  v_plan_total numeric;
  v_base_total numeric;
  v_rate numeric;
  v_last numeric;
  v_last_due date;
  v_plan_id uuid;
  v_i integer;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found
     or (v_claim.user_id <> v_caller and not public.has_claim_access(p_claim_id, 'finanzen', 'write')) then
    raise exception 'Forderung nicht gefunden oder keine Berechtigung.';
  end if;

  if v_claim.status in ('settled', 'cancelled', 'archived') then
    raise exception 'Für diese Forderung kann kein Ratenplan mehr erstellt werden (Status: %).', v_claim.status;
  end if;

  if exists (select 1 from public.payment_plans where claim_id = p_claim_id and status = 'active') then
    raise exception 'Für diese Forderung besteht bereits eine aktive Ratenzahlungsvereinbarung.';
  end if;

  if p_installment_count is null or p_installment_count < 1 or p_installment_count > 120 then
    raise exception 'Die Anzahl der Raten muss zwischen 1 und 120 liegen.';
  end if;
  if p_first_due_date is null then
    raise exception 'Bitte das Fälligkeitsdatum der ersten Rate angeben.';
  end if;
  v_adj := round(coalesce(p_adjustment_amount, 0), 2);
  if v_adj < 0 then
    raise exception 'Der Aufschlag darf nicht negativ sein.';
  end if;

  perform set_config('app.claims_rpc_bypass', '1', true);

  -- 1. Zinsen bis heute festschreiben; während des Plans laufen für die Planpositionen
  --    keine weiteren Zinsen (claim_live_interest lässt sie aus).
  v_cap := coalesce(public.claim_live_interest(p_claim_id, current_date), 0);
  v_fees_before := coalesce(v_claim.accumulated_unpaid_fees, 0);
  v_interest_after := round(coalesce(v_claim.accumulated_unpaid_interest, 0) + v_cap, 2);

  -- 2. Aufschlag als Gebühr auf die Forderung buchen (sonst ist die letzte Rate nicht buchbar)
  update public.claims set
    accumulated_unpaid_interest = v_interest_after,
    interest_start_date = case when interest_start_date is null then null
                               else greatest(interest_start_date, current_date) end,
    accumulated_unpaid_fees = v_fees_before + v_adj,
    updated_at = now()
  where id = p_claim_id;

  select round(coalesce(t.total_due, 0), 2) into v_plan_total
    from public.claim_totals_view t where t.claim_id = p_claim_id;
  v_plan_total := coalesce(v_plan_total, 0);
  v_base_total := v_plan_total - v_adj;
  if v_base_total <= 0 then
    raise exception 'Für diese Forderung ist kein offener Betrag vorhanden.';
  end if;

  -- 3. Raten: gleich hohe Raten, letzte Rate = Rest
  v_rate := round(v_plan_total / p_installment_count, 2);
  v_last := v_plan_total - v_rate * (p_installment_count - 1);
  if v_rate <= 0 or v_last <= 0 then
    raise exception 'Der offene Betrag (% EUR) ist für % Raten zu klein.',
      public.claim_format_eur(v_plan_total), p_installment_count;
  end if;
  v_last_due := (p_first_due_date + make_interval(months => p_installment_count - 1))::date;

  insert into public.payment_plans (
      user_id, claim_id, status, plan_type, total_amount, interest_or_fee_adjustment,
      monthly_rate, first_due_date, last_due_date, accepted_at,
      fees_at_creation, interest_at_creation)
  values (
      v_claim.user_id, p_claim_id, 'active', 'installment_agreement', v_plan_total, v_adj,
      v_rate, p_first_due_date, v_last_due, now(),
      v_fees_before, v_interest_after)
  returning id into v_plan_id;

  for v_i in 1..p_installment_count loop
    insert into public.payment_plan_installments (user_id, payment_plan_id, due_date, amount, paid_amount, status)
    values (v_claim.user_id, v_plan_id,
            (p_first_due_date + make_interval(months => v_i - 1))::date,
            case when v_i = p_installment_count then v_last else v_rate end,
            0, 'open');
  end loop;

  update public.claims set status = 'payment_plan_active', next_action_at = p_first_due_date, updated_at = now()
  where id = p_claim_id;

  insert into public.claim_events (user_id, claim_id, event_type, event_date, description, event_metadata)
  values (v_caller, p_claim_id, 'payment_plan_accepted', now(), 'Ratenzahlungsvereinbarung erstellt',
      jsonb_build_object(
          'payment_plan_id', v_plan_id,
          'plan_total', v_plan_total, 'base_claim_total', v_base_total,
          'adjustment', v_adj, 'surcharge_booked_as_fee', true,
          'capitalized_interest', v_cap,
          'installment_count', p_installment_count,
          'monthly_rate', v_rate, 'last_installment', v_last,
          'first_due_date', p_first_due_date, 'last_due_date', v_last_due, 'note', p_note,
          'fees_at_creation', v_fees_before, 'interest_at_creation', v_interest_after));

  perform set_config('app.claims_rpc_bypass', '', true);
  return v_plan_id;
end;
$function$;


-- -----------------------------------------------------------------------------
-- 5. record_claim_payment
--    H2-08/D1b-22 (Mitnutzer, deterministischer Plan, Planstatus), D1b-02 u. a. (Zinsen
--    über claim_live_interest, netto fortgeschrieben), D1b-09/H1-06/H4-07 (Zinsbeginn nie
--    zurück, NULL bleibt NULL, keine Zukunftsdaten), H2-03/H4-03 (Raten bedienen Gebühren
--    und Zinsen), H2-02/D1b-10 (Rest auf weitere Posten statt 'fees'), D1b-11/H4-09
--    (Positionsgebühren positionsbezogen), D1b-16 (Rundung), D1b-20 u. a. (Meldung)
-- -----------------------------------------------------------------------------
create or replace function public.record_claim_payment(
  p_claim_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_note text,
  p_installment_id uuid default null::uuid,
  p_target_type text default 'auto'::text,
  p_target_claim_item_id uuid default null::uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_caller uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_owner uuid;
  v_amount numeric;
  v_target text := coalesce(nullif(p_target_type, ''), 'auto');
  v_installment_id uuid := p_installment_id;
  v_is_installment boolean := false;
  v_plan_id uuid;
  v_plan_created_at timestamptz;
  v_plan_status text;
  v_plan_booked boolean := false;
  v_plan_remaining numeric := 0;
  v_fees_open numeric := 0;
  v_principal_open numeric := 0;
  v_new_interest numeric := 0;
  v_interest_open numeric := 0;
  v_total_due numeric := 0;
  v_limit numeric;
  v_remaining numeric;
  v_x numeric;
  v_alloc_fees numeric := 0;
  v_alloc_interest numeric := 0;
  v_alloc_principal numeric := 0;
  v_pools_done boolean;
  v_allocs jsonb := '[]'::jsonb;
  v_alloc jsonb;
  v_n integer;
  v_payment_id uuid;
  v_item record;
  v_item_alloc numeric;
  v_target_desc text;
  v_target_open numeric := 0;
  v_target_fee numeric := 0;
  v_target_interest numeric := 0;
  v_item_fee_paid numeric := 0;
  v_item_interest_paid numeric := 0;
  v_item_fee_open numeric := 0;
  v_item_interest_open numeric := 0;
  v_target_fee_alloc numeric := 0;
  v_target_interest_alloc numeric := 0;
  v_target_principal_alloc numeric := 0;
  v_inst_budget numeric := 0;
  v_open_inst record;
  v_inst_alloc numeric;
  v_inst_new_paid numeric;
  v_inst_new_status text;
  v_modified_installments jsonb := '[]'::jsonb;
  v_plan_completed boolean := false;
  v_event_metadata jsonb;
  v_rent_remaining numeric;
  v_rl record;
  v_rl_alloc numeric;
begin
  -- 1. Anmeldung: angemeldeter Nutzer oder Server-Rolle (Stripe-Webhook)
  if v_caller is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Betrag muss größer als 0 sein.';
  end if;
  v_amount := round(p_amount, 2);
  if p_payment_date is null then
    raise exception 'Bitte ein Zahlungsdatum angeben.';
  end if;
  if p_payment_date > current_date + 1 then
    raise exception 'Das Zahlungsdatum darf nicht in der Zukunft liegen.';
  end if;

  if v_target = 'installment' then
    v_target := 'auto';
  end if;
  if v_target not in ('auto', 'claim_items', 'specific_item') then
    raise exception 'Unbekannte Zahlungsart: %', v_target;
  end if;
  if v_target = 'specific_item' and p_target_claim_item_id is null then
    raise exception 'Bitte die Position auswählen, auf die gezahlt wird.';
  end if;
  if v_target <> 'auto' then
    v_installment_id := null;
  end if;

  -- 2. Forderung sperren, Berechtigung prüfen
  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found then
    raise exception 'Forderung nicht gefunden oder keine Berechtigung.';
  end if;
  if v_caller is not null
     and v_claim.user_id <> v_caller
     and not public.has_claim_access(p_claim_id, 'finanzen', 'write') then
    raise exception 'Forderung nicht gefunden oder keine Berechtigung.';
  end if;
  v_owner := v_claim.user_id;

  if v_claim.status in ('settled', 'cancelled', 'archived') then
    raise exception 'Für diese Forderung können keine Zahlungen mehr gebucht werden (Status: %).', v_claim.status;
  end if;

  perform set_config('app.claims_rpc_bypass', '1', true);

  -- 3. Ratenplan (deterministisch: jüngster aktiver Plan) und Rate
  select pp.id, pp.created_at, pp.status into v_plan_id, v_plan_created_at, v_plan_status
    from public.payment_plans pp
   where pp.claim_id = p_claim_id and pp.status = 'active'
   order by pp.created_at desc
   limit 1;

  if v_installment_id is not null then
    select pp.id, pp.created_at, pp.status into v_plan_id, v_plan_created_at, v_plan_status
      from public.payment_plan_installments ppi
      join public.payment_plans pp on pp.id = ppi.payment_plan_id
     where ppi.id = v_installment_id and pp.claim_id = p_claim_id;
    if not found then
      raise exception 'Rate nicht gefunden.';
    end if;
    if v_plan_status <> 'active' then
      raise exception 'Der Ratenplan dieser Rate ist nicht mehr aktiv.';
    end if;
  elsif v_plan_id is not null and v_target = 'auto' then
    select ppi.id into v_installment_id
      from public.payment_plan_installments ppi
     where ppi.payment_plan_id = v_plan_id and ppi.status not in ('paid', 'cancelled')
     order by ppi.due_date, ppi.created_at
     limit 1;
  end if;
  v_is_installment := v_installment_id is not null;

  if v_plan_id is not null then
    select coalesce(sum(greatest(0::numeric, ppi.amount - ppi.paid_amount)), 0) into v_plan_remaining
      from public.payment_plan_installments ppi
     where ppi.payment_plan_id = v_plan_id and ppi.status <> 'cancelled';
    v_plan_booked := exists (
      select 1 from public.claim_events e
       where e.claim_id = p_claim_id
         and e.event_type = 'payment_plan_accepted'
         and e.event_metadata->>'payment_plan_id' = v_plan_id::text
         and e.event_metadata->>'surcharge_booked_as_fee' = 'true');
  end if;

  -- 4. Offene Beträge zum Zahlungsdatum (Zinsformel nur in claim_live_interest)
  select coalesce(t.total_fees_open, 0), coalesce(t.current_principal_open, 0)
    into v_fees_open, v_principal_open
    from public.claim_totals_view t where t.claim_id = p_claim_id;
  v_new_interest := coalesce(public.claim_live_interest(p_claim_id, p_payment_date), 0);
  v_interest_open := round(greatest(0, coalesce(v_claim.accumulated_unpaid_interest, 0) + v_new_interest), 2);
  v_total_due := round(coalesce(v_fees_open, 0) + v_interest_open + coalesce(v_principal_open, 0), 2);

  if v_amount > v_total_due + 0.005 then
    raise exception 'Der Zahlungsbetrag (% EUR) übersteigt die offene Gesamtforderung (% EUR).',
      public.claim_format_eur(v_amount), public.claim_format_eur(v_total_due);
  end if;

  -- Ratenplan-Invariante: Zahlungen außerhalb der Raten dürfen den offenen Planbetrag
  -- nicht aufzehren (sonst wäre die letzte Rate nicht mehr buchbar).
  if v_plan_id is not null and not v_is_installment and v_plan_booked then
    v_limit := round(v_total_due - v_plan_remaining, 2);
    if v_amount > v_limit + 0.005 then
      raise exception 'Der Betrag übersteigt den offenen Betrag außerhalb des Ratenplans (% EUR). Zahlungen auf den Ratenplan bitte als Ratenzahlung buchen.',
        public.claim_format_eur(greatest(v_limit, 0));
    end if;
  end if;

  -- 5. Zielposition (nur Positionen DIESER Forderung)
  if v_target = 'specific_item' then
    select ci.description, coalesce(ctv.open_amount, 0), coalesce(ci.fee_amount, 0), coalesce(ci.interest_amount, 0)
      into v_target_desc, v_target_open, v_target_fee, v_target_interest
      from public.claim_items ci
      left join public.claim_item_totals_view ctv on ctv.claim_item_id = ci.id
     where ci.id = p_target_claim_item_id and ci.claim_id = p_claim_id;
    if not found then
      raise exception 'Die gewählte Position gehört nicht zu dieser Forderung.';
    end if;

    -- Bereits für DIESE Position gezahlte Gebühren/Zinsen (D1b-11, H4-09)
    select coalesce(sum(coalesce(nullif(e.event_metadata->>'target_item_fee_allocated', '')::numeric, pa.fees)), 0),
           coalesce(sum(coalesce(nullif(e.event_metadata->>'target_item_interest_allocated', '')::numeric, pa.interest)), 0)
      into v_item_fee_paid, v_item_interest_paid
      from public.claim_payments cp
      join public.claim_events e
        on e.claim_id = cp.claim_id
       and e.event_type = 'payment_received'
       and e.event_metadata->>'payment_id' = cp.id::text
      cross join lateral (
        select coalesce(sum(a.amount) filter (where a.allocation_bucket = 'fees'), 0) as fees,
               coalesce(sum(a.amount) filter (where a.allocation_bucket = 'interest'), 0) as interest
          from public.claim_payment_allocations a
         where a.claim_payment_id = cp.id
      ) pa
     where cp.claim_id = p_claim_id
       and cp.status = 'posted'
       and e.event_metadata->>'target_item_id' = p_target_claim_item_id::text;

    -- nie mehr als forderungsweit noch offen
    v_item_fee_open := least(greatest(0, v_target_fee - v_item_fee_paid), v_fees_open);
    v_item_interest_open := least(greatest(0, v_target_interest - v_item_interest_paid), v_interest_open);
  end if;

  -- 6. Verteilung: Gebühren -> Zinsen -> Hauptforderung (Zielbereich), Rest auf weitere Posten
  v_remaining := v_amount;
  if v_target = 'specific_item' then
    v_target_fee_alloc := least(v_remaining, v_item_fee_open);
    v_remaining := v_remaining - v_target_fee_alloc;
    v_target_interest_alloc := least(v_remaining, v_item_interest_open);
    v_remaining := v_remaining - v_target_interest_alloc;
    v_alloc_fees := v_target_fee_alloc;
    v_alloc_interest := v_target_interest_alloc;
    v_pools_done := false;
  else
    v_x := least(v_remaining, v_fees_open);
    v_alloc_fees := v_x;
    v_remaining := v_remaining - v_x;
    v_x := least(v_remaining, v_interest_open);
    v_alloc_interest := v_x;
    v_remaining := v_remaining - v_x;
    v_pools_done := true;
  end if;

  -- Reihenfolge der Posten: Zielposition, dann Zielbereich (Rate: Planposten; sonst
  -- Posten außerhalb des Plans), dann übrige Posten; je nach Monat/Anlage.
  for v_item in
    select ci.id, ci.period_month, ci.rent_ledger_ids, ctv.open_amount,
           case
             when v_target = 'specific_item' and ci.id = p_target_claim_item_id then 0
             when v_plan_created_at is null then 1
             when v_is_installment then
               case when coalesce(ci.created_at, '-infinity'::timestamptz) <= v_plan_created_at then 1 else 2 end
             else
               case when coalesce(ci.created_at, '-infinity'::timestamptz) > v_plan_created_at then 1 else 2 end
           end as prio,
           ci.created_at
      from public.claim_items ci
      join public.claim_item_totals_view ctv on ctv.claim_item_id = ci.id
     where ci.claim_id = p_claim_id
       and ctv.open_amount > 0
     order by prio, ci.period_month asc nulls first, ci.created_at asc nulls first, ci.id
  loop
    exit when v_remaining <= 0;

    if not v_pools_done and v_item.prio > 0 then
      -- Überzahlung der Zielposition: zuerst übrige Gebühren und Zinsen
      v_x := least(v_remaining, greatest(0, v_fees_open - v_alloc_fees));
      v_alloc_fees := v_alloc_fees + v_x;
      v_remaining := v_remaining - v_x;
      v_x := least(v_remaining, greatest(0, v_interest_open - v_alloc_interest));
      v_alloc_interest := v_alloc_interest + v_x;
      v_remaining := v_remaining - v_x;
      v_pools_done := true;
      exit when v_remaining <= 0;
    end if;

    v_item_alloc := least(v_remaining, v_item.open_amount);
    if v_item_alloc > 0 then
      v_allocs := v_allocs || jsonb_build_array(jsonb_build_object(
        'item_id', v_item.id, 'amount', v_item_alloc,
        'period_month', v_item.period_month, 'rent_ledger_ids', to_jsonb(v_item.rent_ledger_ids)));
      v_alloc_principal := v_alloc_principal + v_item_alloc;
      v_remaining := v_remaining - v_item_alloc;
      if v_item.prio = 0 then
        v_target_principal_alloc := v_item_alloc;
      end if;
    end if;
  end loop;

  if not v_pools_done and v_remaining > 0 then
    v_x := least(v_remaining, greatest(0, v_fees_open - v_alloc_fees));
    v_alloc_fees := v_alloc_fees + v_x;
    v_remaining := v_remaining - v_x;
    v_x := least(v_remaining, greatest(0, v_interest_open - v_alloc_interest));
    v_alloc_interest := v_alloc_interest + v_x;
    v_remaining := v_remaining - v_x;
  end if;

  -- Rundungsreste unter einem Cent dem letzten Posten zuschlagen; alles andere ablehnen
  if v_remaining > 0 then
    if v_remaining < 0.01 then
      v_n := jsonb_array_length(v_allocs);
      if v_n > 0 then
        v_allocs := jsonb_set(v_allocs, array[(v_n - 1)::text, 'amount'],
                              to_jsonb((v_allocs->(v_n - 1)->>'amount')::numeric + v_remaining));
        v_alloc_principal := v_alloc_principal + v_remaining;
      elsif v_alloc_interest > 0 then
        v_alloc_interest := v_alloc_interest + v_remaining;
      else
        v_alloc_fees := v_alloc_fees + v_remaining;
      end if;
      v_remaining := 0;
    else
      raise exception 'Der Betrag (% EUR) konnte nicht vollständig auf offene Posten verteilt werden.',
        public.claim_format_eur(v_amount);
    end if;
  end if;

  -- 7. Buchen
  insert into public.claim_payments (user_id, claim_id, payment_date, amount, allocation_type, status, note)
  values (v_owner, p_claim_id, p_payment_date, v_amount, 'automatic', 'posted', p_note)
  returning id into v_payment_id;

  if v_alloc_fees > 0 then
    insert into public.claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, amount)
    values (v_payment_id, v_owner, p_claim_id, 'fees', v_alloc_fees);
  end if;
  if v_alloc_interest > 0 then
    insert into public.claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, amount)
    values (v_payment_id, v_owner, p_claim_id, 'interest', v_alloc_interest);
  end if;

  for v_alloc in select value from jsonb_array_elements(v_allocs)
  loop
    insert into public.claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, claim_item_id, amount)
    values (v_payment_id, v_owner, p_claim_id, 'principal', (v_alloc->>'item_id')::uuid, (v_alloc->>'amount')::numeric);

    -- Mietkonto spiegeln (Notiz-Format unverändert, Schutz siehe protect_claim_rent_payments)
    if v_claim.lease_id is not null then
      if jsonb_typeof(v_alloc->'rent_ledger_ids') = 'array' and jsonb_array_length(v_alloc->'rent_ledger_ids') > 0 then
        v_rent_remaining := (v_alloc->>'amount')::numeric;
        for v_rl in
          select id, period_month, expected_rent, coalesce(paid_amount, 0) as paid_amount
            from public.rent_ledger
           where id in (select t.v::uuid from jsonb_array_elements_text(v_alloc->'rent_ledger_ids') as t(v))
           order by period_month asc
        loop
          exit when v_rent_remaining <= 0;
          v_rl_alloc := least(v_rent_remaining, v_rl.expected_rent - v_rl.paid_amount);
          if v_rl_alloc > 0 then
            insert into public.rent_payments (user_id, lease_id, payment_date, period_month, amount, note)
            values (v_owner, v_claim.lease_id, p_payment_date, v_rl.period_month, v_rl_alloc,
                    'Verrechnung Forderungsakte (Ref: ' || v_payment_id || ')');
            v_rent_remaining := v_rent_remaining - v_rl_alloc;
          end if;
        end loop;
      elsif v_alloc->>'period_month' is not null then
        insert into public.rent_payments (user_id, lease_id, payment_date, period_month, amount, note)
        values (v_owner, v_claim.lease_id, p_payment_date, (v_alloc->>'period_month')::date,
                (v_alloc->>'amount')::numeric,
                'Verrechnung Forderungsakte (Ref: ' || v_payment_id || ')');
      end if;
    end if;
  end loop;

  -- 8. Raten fortschreiben (höchstens bis zum offenen Planbetrag)
  if v_is_installment then
    v_inst_budget := least(v_amount, v_plan_remaining);
    for v_open_inst in
      select id, due_date, amount, paid_amount, status
        from public.payment_plan_installments
       where payment_plan_id = v_plan_id and status not in ('paid', 'cancelled')
       order by due_date, created_at
         for update
    loop
      exit when v_inst_budget <= 0;
      v_inst_alloc := least(v_inst_budget, v_open_inst.amount - v_open_inst.paid_amount);
      continue when v_inst_alloc <= 0;
      v_inst_new_paid := v_open_inst.paid_amount + v_inst_alloc;
      v_inst_new_status := case when v_inst_new_paid >= (v_open_inst.amount - 0.01) then 'paid' else 'partial' end;
      v_modified_installments := v_modified_installments || jsonb_build_array(jsonb_build_object(
        'id', v_open_inst.id,
        'due_date', v_open_inst.due_date,
        'old_paid_amount', v_open_inst.paid_amount,
        'old_status', v_open_inst.status,
        'new_status', v_inst_new_status,
        'allocated_amount', v_inst_alloc));
      update public.payment_plan_installments
         set paid_amount = v_inst_new_paid, status = v_inst_new_status, updated_at = now()
       where id = v_open_inst.id;
      v_inst_budget := v_inst_budget - v_inst_alloc;
    end loop;

    select coalesce(bool_and(status = 'paid'), false) into v_plan_completed
      from public.payment_plan_installments
     where payment_plan_id = v_plan_id and status <> 'cancelled';
    if v_plan_completed then
      update public.payment_plans set status = 'completed', updated_at = now() where id = v_plan_id;
    end if;
  end if;

  -- 9. Forderung: Zinsen netto fortschreiben, Zinsbeginn nie zurück (NULL bleibt NULL)
  update public.claims set
    accumulated_unpaid_interest = round(greatest(0, v_interest_open - v_alloc_interest), 2),
    interest_start_date = case when interest_start_date is null then null
                               else greatest(interest_start_date, p_payment_date) end,
    status = case
               when v_amount >= (v_total_due - 0.01) then 'settled'
               when v_plan_completed and status = 'payment_plan_active' then 'open'
               else status
             end,
    updated_at = now()
  where id = p_claim_id;

  -- 10. Ereignis (Felder wie bisher + Angaben für das Storno)
  v_event_metadata := jsonb_build_object(
    'payment_id', v_payment_id,
    'payment_date', p_payment_date,
    'amount', v_amount,
    'allocated_to_fees', v_alloc_fees,
    'allocated_to_interest', v_alloc_interest,
    'allocated_to_principal', v_alloc_principal,
    'remaining_total_due', greatest(0, round(v_total_due - v_amount, 2)),
    'capitalized_interest', v_new_interest,
    'old_interest_start_date', v_claim.interest_start_date,
    'old_accumulated_unpaid_interest', v_claim.accumulated_unpaid_interest,
    'old_claim_status', v_claim.status);

  if v_target = 'specific_item' then
    v_event_metadata := v_event_metadata || jsonb_build_object(
      'target_type', 'specific_item',
      'target_item_id', p_target_claim_item_id,
      'target_item_description', v_target_desc,
      'target_item_open_before', round(v_target_open + v_item_fee_open + v_item_interest_open, 2),
      'target_item_open_after', greatest(0, round(v_target_open + v_item_fee_open + v_item_interest_open
                                        - v_target_fee_alloc - v_target_interest_alloc - v_target_principal_alloc, 2)),
      'target_item_fee_allocated', v_target_fee_alloc,
      'target_item_interest_allocated', v_target_interest_alloc);
  elsif v_target = 'claim_items' then
    v_event_metadata := v_event_metadata || jsonb_build_object('target_type', 'claim_items');
  end if;

  if v_is_installment then
    v_event_metadata := v_event_metadata || jsonb_build_object(
      'payment_plan_id', v_plan_id,
      'installment_id', v_installment_id,
      'old_plan_status', 'active',
      'plan_completed', v_plan_completed,
      'modified_installments', v_modified_installments);
  end if;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (coalesce(v_caller, v_owner), p_claim_id, 'payment_received', 'Zahlung erfasst', v_event_metadata);

  perform set_config('app.claims_rpc_bypass', '', true);
  perform public.sync_all_rent_ledgers();
end;
$function$;


-- -----------------------------------------------------------------------------
-- 6. reverse_claim_payment
--    H1-01 (Zugriff auf die Forderung, Raten/Pläne nur dieser Forderung),
--    D1b-04/H1-05/H4-11 (Zinsstand per Differenz statt Snapshot, alter Status),
--    H4-17 (Ratenstatus aus Betrag), D1b-14/H1-09/H4-10/R2-09 (Zahlung bleibt als
--    'cancelled' erhalten, Ereignis 'payment_reversed')
-- -----------------------------------------------------------------------------
create or replace function public.reverse_claim_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_caller uuid := auth.uid();
  v_pay public.claim_payments%rowtype;
  v_claim public.claims%rowtype;
  v_event jsonb;
  v_inst jsonb;
  v_row record;
  v_alloc_fees numeric := 0;
  v_alloc_interest numeric := 0;
  v_alloc_principal numeric := 0;
  v_principal_bearing numeric := 0;
  v_correction numeric := 0;
  v_reversed_allocs jsonb;
  v_active_plan_created_at timestamptz;
  v_new_paid numeric;
  v_has_active_plan boolean;
  v_old_status text;
  v_new_status text;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_pay from public.claim_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Zahlung nicht gefunden oder keine Berechtigung.';
  end if;

  -- Berechtigung auf die FORDERUNG (nicht nur auf die Zahlungszeile)
  select * into v_claim from public.claims where id = v_pay.claim_id for update;
  if not found
     or (v_claim.user_id <> v_caller and not public.has_claim_access(v_claim.id, 'finanzen', 'write')) then
    raise exception 'Zahlung nicht gefunden oder keine Berechtigung.';
  end if;

  if v_pay.status = 'cancelled' then
    return;  -- bereits storniert
  end if;

  perform set_config('app.claims_rpc_bypass', '1', true);

  if v_pay.status <> 'posted' then
    -- Entwurf ohne Buchungswirkung
    update public.claim_payments set status = 'cancelled' where id = p_payment_id;
    perform set_config('app.claims_rpc_bypass', '', true);
    return;
  end if;

  -- Ereignis der Zahlung (nur dieser Forderung)
  select e.event_metadata into v_event
    from public.claim_events e
   where e.claim_id = v_claim.id
     and e.event_type = 'payment_received'
     and e.event_metadata->>'payment_id' = p_payment_id::text
   order by e.created_at, e.id
   limit 1;

  -- Zuordnungen der Zahlung (Quelle: Tabelle, nicht Metadaten)
  select coalesce(sum(amount) filter (where allocation_bucket = 'fees'), 0),
         coalesce(sum(amount) filter (where allocation_bucket = 'interest'), 0),
         coalesce(sum(amount) filter (where allocation_bucket = 'principal'), 0),
         coalesce(jsonb_agg(jsonb_build_object('bucket', allocation_bucket, 'claim_item_id', claim_item_id, 'amount', amount)), '[]'::jsonb)
    into v_alloc_fees, v_alloc_interest, v_alloc_principal, v_reversed_allocs
    from public.claim_payment_allocations
   where claim_payment_id = p_payment_id;

  -- Zinskorrektur: die zurückgebuchte Hauptforderung war seit dem Zahlungstag zinspflichtig.
  -- Nicht bei Ratenzahlungen (Planpositionen zinsfrei) und nicht, wenn seither ein
  -- Ratenplan angelegt wurde (dann zugunsten des Mieters keine Nachberechnung).
  if v_claim.interest_start_date is not null
     and v_pay.payment_date < v_claim.interest_start_date
     and coalesce(v_event->>'payment_plan_id', '') = ''
     and not exists (select 1 from public.payment_plans pp
                      where pp.claim_id = v_claim.id and pp.created_at > v_pay.created_at) then
    select max(pp.created_at) into v_active_plan_created_at
      from public.payment_plans pp where pp.claim_id = v_claim.id and pp.status = 'active';
    select coalesce(sum(a.amount), 0) into v_principal_bearing
      from public.claim_payment_allocations a
      join public.claim_items ci on ci.id = a.claim_item_id
     where a.claim_payment_id = p_payment_id
       and a.allocation_bucket = 'principal'
       and (v_active_plan_created_at is null
            or coalesce(ci.created_at, '-infinity'::timestamptz) > v_active_plan_created_at);
    v_correction := public.claim_interest_amount(v_principal_bearing, v_claim.interest_rate,
                                                 v_pay.payment_date, v_claim.interest_start_date);
  end if;

  update public.claims set
    accumulated_unpaid_interest = round(coalesce(accumulated_unpaid_interest, 0) + v_alloc_interest + v_correction, 2),
    updated_at = now()
  where id = v_claim.id;

  -- Raten zurückrechnen (nur Raten von Plänen dieser Forderung)
  if v_event is not null and jsonb_typeof(v_event->'modified_installments') = 'array' then
    for v_inst in select value from jsonb_array_elements(v_event->'modified_installments')
    loop
      continue when coalesce(v_inst->>'id', '') !~ v_uuid_re;
      select ppi.id, ppi.amount, ppi.paid_amount, ppi.status, pp.status as plan_status into v_row
        from public.payment_plan_installments ppi
        join public.payment_plans pp on pp.id = ppi.payment_plan_id
       where ppi.id = (v_inst->>'id')::uuid and pp.claim_id = v_claim.id
         for update of ppi;
      continue when not found;
      if nullif(v_inst->>'allocated_amount', '') is not null then
        v_new_paid := v_row.paid_amount - (v_inst->>'allocated_amount')::numeric;
      else
        v_new_paid := coalesce(nullif(v_inst->>'old_paid_amount', '')::numeric, 0);
      end if;
      v_new_paid := greatest(0, least(v_row.amount, v_new_paid));
      update public.payment_plan_installments set
        paid_amount = v_new_paid,
        status = case
                   when v_row.status = 'cancelled' or v_row.plan_status = 'cancelled' then 'cancelled'
                   when v_new_paid <= 0.005 then 'open'
                   when v_new_paid < v_row.amount - 0.01 then 'partial'
                   else 'paid'
                 end,
        updated_at = now()
      where id = v_row.id;
    end loop;
  elsif v_event is not null and coalesce(v_event->>'installment_id', '') ~ v_uuid_re then
    -- ältere Ereignisse ohne Kaskade
    select ppi.id, ppi.amount, ppi.paid_amount, ppi.status, pp.status as plan_status into v_row
      from public.payment_plan_installments ppi
      join public.payment_plans pp on pp.id = ppi.payment_plan_id
     where ppi.id = (v_event->>'installment_id')::uuid and pp.claim_id = v_claim.id
       for update of ppi;
    if found then
      v_new_paid := greatest(0, least(v_row.amount, coalesce(nullif(v_event->>'old_installment_paid_amount', '')::numeric, 0)));
      update public.payment_plan_installments set
        paid_amount = v_new_paid,
        status = case
                   when v_row.status = 'cancelled' or v_row.plan_status = 'cancelled' then 'cancelled'
                   when v_new_paid <= 0.005 then 'open'
                   when v_new_paid < v_row.amount - 0.01 then 'partial'
                   else 'paid'
                 end,
        updated_at = now()
      where id = v_row.id;
    end if;
  end if;

  -- Durch diese Zahlung abgeschlossener Plan wird wieder aktiv (nur wenn kein anderer aktiv ist)
  update public.payment_plans pp set status = 'active', updated_at = now()
   where pp.claim_id = v_claim.id
     and pp.status = 'completed'
     and exists (select 1 from public.payment_plan_installments i
                  where i.payment_plan_id = pp.id and i.status not in ('paid', 'cancelled'))
     and not exists (select 1 from public.payment_plans o
                      where o.claim_id = v_claim.id and o.status = 'active' and o.id <> pp.id);

  -- Status der Forderung
  select exists (select 1 from public.payment_plans where claim_id = v_claim.id and status = 'active')
    into v_has_active_plan;
  v_old_status := nullif(v_event->>'old_claim_status', '');
  v_new_status := case
    when v_claim.status = 'settled' then
      case
        when v_has_active_plan then 'payment_plan_active'
        when v_old_status is not null
             and v_old_status not in ('settled', 'cancelled', 'archived', 'payment_plan_active') then v_old_status
        else 'open'
      end
    when v_claim.status = 'open' and v_has_active_plan then 'payment_plan_active'
    else v_claim.status
  end;
  update public.claims set status = v_new_status, updated_at = now() where id = v_claim.id;

  -- Gespiegelte Mietzahlungen entfernen (Mietkonto zeigt den Rückstand wieder)
  perform set_config('app.bypass_rent_payment_protect', '1', true);
  delete from public.rent_payments
   where user_id = v_claim.user_id
     and note like '%(Ref: ' || p_payment_id::text || ')%';
  perform set_config('app.bypass_rent_payment_protect', '', true);

  -- Zahlung bleibt als storniert erhalten; Zuordnungen werden entfernt (sie stehen im
  -- Storno-Ereignis), damit Positionen später gelöscht werden können.
  delete from public.claim_payment_allocations where claim_payment_id = p_payment_id;
  update public.claim_payments set status = 'cancelled' where id = p_payment_id;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (v_caller, v_claim.id, 'payment_reversed', 'Zahlung storniert',
      jsonb_build_object(
          'payment_id', p_payment_id,
          'amount', v_pay.amount,
          'original_payment_date', v_pay.payment_date,
          'reversal_date', current_date,
          'reason', 'Manuell storniert',
          'reversed_fees', v_alloc_fees,
          'reversed_interest', v_alloc_interest,
          'reversed_principal', v_alloc_principal,
          'reversed_allocations', v_reversed_allocs,
          'interest_correction', v_correction,
          'old_claim_status', v_claim.status,
          'new_claim_status', v_new_status));

  perform set_config('app.claims_rpc_bypass', '', true);
  perform public.sync_all_rent_ledgers();
end;
$function$;


-- -----------------------------------------------------------------------------
-- 7. reverse_payment_plan
--    H1-12 (bezahlte Raten: Plan wird 'cancelled' statt gelöscht; Ereignis),
--    Aufschlag (sofern als Gebühr gebucht) wird ausgebucht, soweit nicht bezahlt;
--    Zinsen laufen ab heute wieder.
-- -----------------------------------------------------------------------------
create or replace function public.reverse_payment_plan(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_caller uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_plan public.payment_plans%rowtype;
  v_paid numeric := 0;
  v_cap numeric := 0;
  v_booked boolean := false;
  v_adj numeric := 0;
  v_fees_paid numeric := 0;
  v_new_fees numeric;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found
     or (v_claim.user_id <> v_caller and not public.has_claim_access(p_claim_id, 'finanzen', 'write')) then
    raise exception 'Keine Berechtigung.';
  end if;

  select * into v_plan
    from public.payment_plans
   where claim_id = p_claim_id and status = 'active'
   order by created_at desc
   limit 1
     for update;
  if not found then
    raise exception 'Kein aktiver Ratenplan für diese Forderung gefunden.';
  end if;

  perform set_config('app.claims_rpc_bypass', '1', true);

  -- Zinsen bis heute (Planpositionen waren zinsfrei) festschreiben
  v_cap := coalesce(public.claim_live_interest(p_claim_id, current_date), 0);

  -- Aufschlag nur ausbuchen, wenn ihn create_payment_plan als Gebühr gebucht hat
  v_booked := exists (
    select 1 from public.claim_events e
     where e.claim_id = p_claim_id
       and e.event_type = 'payment_plan_accepted'
       and e.event_metadata->>'payment_plan_id' = v_plan.id::text
       and e.event_metadata->>'surcharge_booked_as_fee' = 'true');
  if v_booked then
    v_adj := greatest(0, coalesce(v_plan.interest_or_fee_adjustment, 0));
  end if;
  select coalesce(sum(a.amount), 0) into v_fees_paid
    from public.claim_payment_allocations a
    join public.claim_payments cp on cp.id = a.claim_payment_id
   where cp.claim_id = p_claim_id and cp.status = 'posted' and a.allocation_bucket = 'fees';
  v_new_fees := greatest(coalesce(v_claim.accumulated_unpaid_fees, 0) - v_adj,
                         least(coalesce(v_claim.accumulated_unpaid_fees, 0), v_fees_paid));

  select coalesce(sum(paid_amount), 0) into v_paid
    from public.payment_plan_installments where payment_plan_id = v_plan.id;

  if v_paid > 0 then
    -- Bereits (teil)bezahlt: Plan als storniert behalten (Nachweis der Vereinbarung)
    update public.payment_plan_installments
       set status = 'cancelled', updated_at = now()
     where payment_plan_id = v_plan.id and status <> 'paid';
    update public.payment_plans
       set status = 'cancelled', cancelled_at = now(), cancelled_by = v_caller,
           cancellation_reason = 'Ratenplan rückgängig gemacht', updated_at = now()
     where id = v_plan.id;
  else
    delete from public.payment_plan_installments where payment_plan_id = v_plan.id;
    delete from public.payment_plans where id = v_plan.id;
  end if;

  update public.claims set
    accumulated_unpaid_interest = round(coalesce(accumulated_unpaid_interest, 0) + v_cap, 2),
    interest_start_date = case when interest_start_date is null then null
                               else greatest(interest_start_date, current_date) end,
    accumulated_unpaid_fees = v_new_fees,
    status = case when status = 'payment_plan_active' then 'open' else status end,
    next_action_at = null,
    updated_at = now()
  where id = p_claim_id;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (v_caller, p_claim_id, 'note_added', 'Ratenzahlungsvereinbarung rückgängig gemacht',
      jsonb_build_object(
          'source', 'payment_plan_reversed',
          'payment_plan_id', v_plan.id,
          'paid_in_plan', v_paid,
          'plan_kept_as_cancelled', v_paid > 0,
          'surcharge_removed', coalesce(v_claim.accumulated_unpaid_fees, 0) - v_new_fees,
          'capitalized_interest', v_cap));

  perform set_config('app.claims_rpc_bypass', '', true);
end;
$function$;


-- -----------------------------------------------------------------------------
-- 8. reverse_appended_claim
--    H1-01-Muster (Zugriff auf die FORDERUNG statt Ereignis-Eigentümer), Positionen des
--    Nachtrags werden sicher gefunden (gleiche Transaktion, auch gruppierte Mieten),
--    keine Löschung bei gebuchten Zahlungen oder aktivem Ratenplan.
-- -----------------------------------------------------------------------------
create or replace function public.reverse_appended_claim(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_caller uuid := auth.uid();
  v_ev public.claim_events%rowtype;
  v_claim public.claims%rowtype;
  v_item jsonb;
  v_ids uuid[] := '{}'::uuid[];
  v_fee numeric;
  v_interest numeric;
  v_fees_paid numeric := 0;
  v_new_fees numeric;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_ev
    from public.claim_events
   where id = p_event_id and event_type = 'note_added' and event_metadata->>'source' = 'append_advanced'
     for update;
  if not found then
    raise exception 'Das Ereignis wurde nicht gefunden oder ist keine Erweiterung der Akte.';
  end if;

  select * into v_claim from public.claims where id = v_ev.claim_id for update;
  if not found
     or (v_claim.user_id <> v_caller and not public.has_claim_access(v_claim.id, 'finanzen', 'write')) then
    raise exception 'Keine Berechtigung.';
  end if;

  -- Positionen des Nachtrags: in derselben Transaktion angelegt (created_at = Ereignis)
  if jsonb_typeof(v_ev.event_metadata->'items') = 'array' then
    for v_item in select value from jsonb_array_elements(v_ev.event_metadata->'items')
    loop
      if coalesce(v_item->>'rent_ledger_id', '') ~ v_uuid_re then
        v_ids := v_ids || array(
          select ci.id from public.claim_items ci
           where ci.claim_id = v_claim.id
             and ci.created_at is not distinct from v_ev.created_at
             and (ci.rent_ledger_id = (v_item->>'rent_ledger_id')::uuid
                  or (v_item->>'rent_ledger_id')::uuid = any(ci.rent_ledger_ids)));
      else
        v_ids := v_ids || array(
          select ci.id from public.claim_items ci
           where ci.claim_id = v_claim.id
             and ci.created_at is not distinct from v_ev.created_at
             and ci.rent_ledger_id is null and ci.rent_ledger_ids is null
             and ci.description is not distinct from (v_item->>'description')
             and ci.original_amount = coalesce(nullif(v_item->>'amount', '')::numeric, -1)
             and not (ci.id = any(v_ids))
           order by ci.id
           limit 1);
      end if;
    end loop;

    -- Ältere Daten ohne übereinstimmenden Zeitstempel: bisherige Zuordnung
    if cardinality(v_ids) = 0 then
      for v_item in select value from jsonb_array_elements(v_ev.event_metadata->'items')
      loop
        if coalesce(v_item->>'rent_ledger_id', '') ~ v_uuid_re then
          v_ids := v_ids || array(
            select ci.id from public.claim_items ci
             where ci.claim_id = v_claim.id
               and (ci.rent_ledger_id = (v_item->>'rent_ledger_id')::uuid
                    or (v_item->>'rent_ledger_id')::uuid = any(ci.rent_ledger_ids))
             order by ci.created_at desc nulls last
             limit 1);
        else
          v_ids := v_ids || array(
            select ci.id from public.claim_items ci
             where ci.claim_id = v_claim.id
               and ci.rent_ledger_id is null and ci.rent_ledger_ids is null
               and ci.description is not distinct from (v_item->>'description')
               and ci.original_amount = coalesce(nullif(v_item->>'amount', '')::numeric, -1)
               and not (ci.id = any(v_ids))
             order by ci.created_at desc nulls last
             limit 1);
        end if;
      end loop;
    end if;
  end if;
  v_ids := array(select distinct x from unnest(v_ids) as t(x) where x is not null);

  if exists (select 1 from public.claim_payment_allocations where claim_item_id = any(v_ids)) then
    raise exception 'Für mindestens eine nachgetragene Position wurden bereits Zahlungen gebucht. Bitte zuerst diese Zahlungen stornieren.';
  end if;
  if exists (
    select 1 from public.payment_plans pp
     where pp.claim_id = v_claim.id and pp.status = 'active'
       and exists (select 1 from public.claim_items ci
                    where ci.id = any(v_ids)
                      and coalesce(ci.created_at, '-infinity'::timestamptz) <= pp.created_at)) then
    raise exception 'Die nachgetragenen Positionen sind Teil einer aktiven Ratenzahlungsvereinbarung. Bitte den Ratenplan zuerst rückgängig machen.';
  end if;

  perform set_config('app.claims_rpc_bypass', '1', true);

  -- Gebühr und übergebene Zinsen des Nachtrags ausbuchen (bezahlte Gebühren bleiben)
  v_fee := greatest(0, coalesce(nullif(v_ev.event_metadata->>'fee_amount', '')::numeric, 0));
  v_interest := greatest(0, coalesce(nullif(v_ev.event_metadata->>'accumulated_interest', '')::numeric, 0));
  select coalesce(sum(a.amount), 0) into v_fees_paid
    from public.claim_payment_allocations a
    join public.claim_payments cp on cp.id = a.claim_payment_id
   where cp.claim_id = v_claim.id and cp.status = 'posted' and a.allocation_bucket = 'fees';
  v_new_fees := greatest(coalesce(v_claim.accumulated_unpaid_fees, 0) - v_fee,
                         least(coalesce(v_claim.accumulated_unpaid_fees, 0), v_fees_paid));

  update public.claims set
    accumulated_unpaid_fees = v_new_fees,
    accumulated_unpaid_interest = round(greatest(0, coalesce(accumulated_unpaid_interest, 0) - v_interest), 2),
    updated_at = now()
  where id = v_claim.id;

  delete from public.claim_items where id = any(v_ids);
  delete from public.claim_events where id = p_event_id;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (v_caller, v_claim.id, 'note_added', 'Nachtrag rückgängig gemacht',
      jsonb_build_object('source', 'append_reversed', 'reversed_event_id', p_event_id,
                         'deleted_item_ids', to_jsonb(v_ids), 'fee_removed', coalesce(v_claim.accumulated_unpaid_fees, 0) - v_new_fees,
                         'interest_removed', v_interest, 'items', v_ev.event_metadata->'items'));

  perform set_config('app.claims_rpc_bypass', '', true);
end;
$function$;


-- -----------------------------------------------------------------------------
-- 9. settle_claim_item (Erlass/Ausbuchung) – H2-07 (Kennzeichnung, Status), Berechtigung,
--    keine Ausbuchung von Planpositionen während eines aktiven Ratenplans
-- -----------------------------------------------------------------------------
create or replace function public.settle_claim_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_caller uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_claim_id uuid;
  v_item_created timestamptz;
  v_desc text;
  v_open numeric;
  v_payment_id uuid;
  v_cap numeric := 0;
  v_plan_id uuid;
  v_plan_created timestamptz;
  v_plan_remaining numeric := 0;
  v_total_due numeric;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select ci.claim_id, ci.created_at, ci.description
    into v_claim_id, v_item_created, v_desc
    from public.claim_items ci where ci.id = p_item_id;
  if not found then
    raise exception 'Position nicht gefunden oder keine Berechtigung.';
  end if;
  select * into v_claim from public.claims where id = v_claim_id for update;
  if not found
     or (v_claim.user_id <> v_caller and not public.has_claim_access(v_claim_id, 'finanzen', 'write')) then
    raise exception 'Position nicht gefunden oder keine Berechtigung.';
  end if;

  if v_claim.status in ('settled', 'cancelled', 'archived') then
    raise exception 'Für diese Forderung können keine Positionen mehr als erledigt markiert werden (Status: %).', v_claim.status;
  end if;

  select coalesce(open_amount, 0) into v_open from public.claim_item_totals_view where claim_item_id = p_item_id;
  if coalesce(v_open, 0) <= 0 then
    raise exception 'Position ist bereits vollständig erledigt.';
  end if;

  select id, created_at into v_plan_id, v_plan_created
    from public.payment_plans where claim_id = v_claim_id and status = 'active'
   order by created_at desc limit 1;
  if v_plan_id is not null then
    if coalesce(v_item_created, '-infinity'::timestamptz) <= v_plan_created then
      raise exception 'Diese Position ist Teil einer aktiven Ratenzahlungsvereinbarung. Bitte den Ratenplan zuerst rückgängig machen.';
    end if;
    -- Invariante wie in record_claim_payment (nur für Pläne mit gebuchtem Aufschlag)
    if exists (select 1 from public.claim_events e
                where e.claim_id = v_claim_id
                  and e.event_type = 'payment_plan_accepted'
                  and e.event_metadata->>'payment_plan_id' = v_plan_id::text
                  and e.event_metadata->>'surcharge_booked_as_fee' = 'true') then
      select coalesce(sum(greatest(0::numeric, amount - paid_amount)), 0) into v_plan_remaining
        from public.payment_plan_installments where payment_plan_id = v_plan_id and status <> 'cancelled';
      select round(coalesce(total_due, 0), 2) into v_total_due from public.claim_totals_view where claim_id = v_claim_id;
      if v_open > round(coalesce(v_total_due, 0) - v_plan_remaining, 2) + 0.005 then
        raise exception 'Die Position kann nicht ausgebucht werden, solange der Ratenplan offen ist.';
      end if;
    end if;
  end if;

  -- Zinsen bis heute festschreiben, dann die Hauptforderung der Position ausbuchen
  v_cap := coalesce(public.claim_live_interest(v_claim_id, current_date), 0);
  update public.claims set
    accumulated_unpaid_interest = round(coalesce(accumulated_unpaid_interest, 0) + v_cap, 2),
    interest_start_date = case when interest_start_date is null then null
                               else greatest(interest_start_date, current_date) end,
    updated_at = now()
  where id = v_claim_id;

  insert into public.claim_payments (user_id, claim_id, payment_date, amount, allocation_type, status, note)
  values (v_claim.user_id, v_claim_id, current_date, v_open, 'manual', 'posted', 'Als erledigt markiert (Erlass/Ausbuchung)')
  returning id into v_payment_id;

  insert into public.claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, claim_item_id, amount)
  values (v_payment_id, v_claim.user_id, v_claim_id, 'principal', p_item_id, v_open);

  select round(coalesce(total_due, 0), 2) into v_total_due from public.claim_totals_view where claim_id = v_claim_id;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (v_caller, v_claim_id, 'payment_received', 'Position manuell als erledigt markiert (Erlass/Ausbuchung, kein Geldeingang)',
      jsonb_build_object(
          'payment_id', v_payment_id,
          'payment_date', current_date,
          'amount', v_open,
          'allocated_to_fees', 0,
          'allocated_to_interest', 0,
          'allocated_to_principal', v_open,
          'waiver', true,
          'target_type', 'specific_item',
          'target_item_id', p_item_id,
          'target_item_description', v_desc,
          'target_item_open_after', 0,
          'remaining_total_due', greatest(0, coalesce(v_total_due, 0)),
          'capitalized_interest', v_cap,
          'old_claim_status', v_claim.status,
          'note', 'Als erledigt markiert'));

  if coalesce(v_total_due, 0) <= 0.01 then
    update public.claims set status = 'settled', updated_at = now() where id = v_claim_id;
  end if;
end;
$function$;


-- -----------------------------------------------------------------------------
-- 10. delete_claim_item – H2-10 (verständliche Meldung bei Zahlungen, Gebühr/Zins der
--     Position geht nicht verloren), Berechtigung, Schutz aktiver Ratenpläne
-- -----------------------------------------------------------------------------
create or replace function public.delete_claim_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_caller uuid := auth.uid();
  v_item public.claim_items%rowtype;
  v_claim public.claims%rowtype;
  v_other uuid;
  v_plan_created timestamptz;
  v_fees_paid numeric := 0;
  v_moved_to uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_item from public.claim_items where id = p_item_id;
  if not found then
    raise exception 'Position nicht gefunden';
  end if;
  select * into v_claim from public.claims where id = v_item.claim_id for update;
  if not found
     or (v_claim.user_id <> v_caller and not public.has_claim_access(v_item.claim_id, 'finanzen', 'write')) then
    raise exception 'Keine Berechtigung.';
  end if;

  if exists (select 1 from public.claim_payment_allocations where claim_item_id = p_item_id) then
    raise exception 'Diese Position hat bereits zugeordnete Zahlungen. Bitte zuerst die Zahlungen rückabwickeln.';
  end if;

  select max(created_at) into v_plan_created
    from public.payment_plans where claim_id = v_item.claim_id and status = 'active';
  if v_plan_created is not null and coalesce(v_item.created_at, '-infinity'::timestamptz) <= v_plan_created then
    raise exception 'Diese Position ist Teil einer aktiven Ratenzahlungsvereinbarung. Bitte den Ratenplan zuerst rückgängig machen.';
  end if;

  -- Gebühr/Zinsen der Position: auf eine verbleibende Position übertragen; ist es die
  -- letzte Position, aus der Forderung ausbuchen (bezahlte Gebühren bleiben stehen).
  if coalesce(v_item.fee_amount, 0) > 0 or coalesce(v_item.interest_amount, 0) > 0 then
    select id into v_other
      from public.claim_items
     where claim_id = v_item.claim_id and id <> p_item_id
     order by created_at asc nulls first, id
     limit 1;
    if v_other is not null then
      update public.claim_items set
        fee_amount = fee_amount + coalesce(v_item.fee_amount, 0),
        interest_amount = interest_amount + coalesce(v_item.interest_amount, 0)
      where id = v_other;
      v_moved_to := v_other;
    else
      select coalesce(sum(a.amount), 0) into v_fees_paid
        from public.claim_payment_allocations a
        join public.claim_payments cp on cp.id = a.claim_payment_id
       where cp.claim_id = v_item.claim_id and cp.status = 'posted' and a.allocation_bucket = 'fees';
      update public.claims set
        accumulated_unpaid_fees = greatest(accumulated_unpaid_fees - coalesce(v_item.fee_amount, 0),
                                           least(accumulated_unpaid_fees, v_fees_paid)),
        accumulated_unpaid_interest = round(greatest(0, accumulated_unpaid_interest - coalesce(v_item.interest_amount, 0)), 2),
        updated_at = now()
      where id = v_item.claim_id;
    end if;
  end if;

  delete from public.claim_items where id = p_item_id;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (v_claim.user_id, v_item.claim_id, 'note_added',
          'Forderungsposition gelöscht: ' || coalesce(v_item.description, '') || ' (' || v_item.original_amount || ' EUR)',
          jsonb_build_object('source', 'item_deleted', 'item_id', p_item_id, 'description', v_item.description,
                             'amount', v_item.original_amount, 'fee_amount', v_item.fee_amount,
                             'interest_amount', v_item.interest_amount, 'fees_moved_to_item', v_moved_to,
                             'deleted_by', v_caller));
end;
$function$;


-- -----------------------------------------------------------------------------
-- 11. get_next_invoice_number – D1a-13 (keine Kürzung ab 1000, nie NULL),
--     Berechtigung, NULL-sicheres object_unit_id, Zähler je Portfolio (auch für Mitnutzer)
-- -----------------------------------------------------------------------------
create or replace function public.get_next_invoice_number(p_portfolio_id uuid, p_object_unit_id uuid, p_year integer)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_id uuid;
  v_next integer;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if p_portfolio_id is null or p_year is null then
    raise exception 'Portfolio und Jahr sind erforderlich.';
  end if;

  select user_id into v_owner from public.portfolios where id = p_portfolio_id;
  if v_owner is null
     or (v_owner <> v_caller and not public.has_portfolio_access(p_portfolio_id, 'finanzen', 'write')) then
    raise exception 'Portfolio nicht gefunden oder keine Berechtigung.';
  end if;

  -- Vergabe je Zähler serialisieren (der Unique-Index greift bei object_unit_id NULL nicht)
  perform pg_advisory_xact_lock(hashtextextended(
    'invoice_counter:' || p_portfolio_id::text || ':' || p_year::text || ':' || coalesce(p_object_unit_id::text, '-'), 0));

  select id into v_id
    from public.invoice_counters
   where portfolio_id = p_portfolio_id
     and year = p_year
     and object_unit_id is not distinct from p_object_unit_id
   order by last_number desc, created_at nulls first, id
   limit 1
     for update;

  if v_id is null then
    insert into public.invoice_counters (user_id, portfolio_id, year, object_unit_id, last_number)
    values (v_owner, p_portfolio_id, p_year, p_object_unit_id, 0)
    returning id into v_id;
  end if;

  update public.invoice_counters
     set last_number = last_number + 1
   where id = v_id
  returning last_number into v_next;

  if v_next is null then
    raise exception 'Rechnungsnummer konnte nicht vergeben werden.';
  end if;

  return p_year::text || '-' || case when v_next < 1000 then lpad(v_next::text, 3, '0') else v_next::text end;
end;
$function$;


-- -----------------------------------------------------------------------------
-- 12. search_path für unveränderte Funktionen dieses Pakets
-- -----------------------------------------------------------------------------
alter function public.block_claim_events_update() set search_path = public, pg_temp;
alter function public.create_claim_from_rent_ledger(uuid, numeric, numeric, date, integer, text) set search_path = public, pg_temp;
alter function public.create_claim_from_rent_ledgers(uuid[], numeric, numeric, date, integer, text) set search_path = public, pg_temp;
alter function public.create_claim_from_rent_ledgers(uuid[], numeric, numeric, numeric, date, integer, text) set search_path = public, pg_temp;
alter function public.verify_payment_allocations_sum() set search_path = public, pg_temp;
alter function public.protect_claim_item_original_amount() set search_path = public, pg_temp;

-- R2-10: maßgebliche Fassung (= Live-Stand, alter Status wird korrekt protokolliert) als
-- nummerierte Migration festgehalten; nur search_path ergänzt.
create or replace function public.update_overdue_claims_status()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  claim_record record;
  current_user_id uuid;
  updated_count integer := 0;
  v_old_status text;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  for claim_record in
    select id, status from public.claims
     where user_id = current_user_id
       and status in ('sent', 'open')
       and deadline < current_date
  loop
    v_old_status := claim_record.status;
    update public.claims set status = 'action_required' where id = claim_record.id and user_id = current_user_id;

    insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
    values (
      current_user_id,
      claim_record.id,
      'deadline_expired',
      'Die gesetzte Frist ist abgelaufen. Status wurde automatisch auf Aktion erforderlich gesetzt.',
      jsonb_build_object('old_status', v_old_status, 'new_status', 'action_required')
    );
    updated_count := updated_count + 1;
  end loop;

  return updated_count;
end;
$function$;
