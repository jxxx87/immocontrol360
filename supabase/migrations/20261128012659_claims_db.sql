-- =============================================================================
-- Wave 3 · Paket 01 CLAIMS-DB · Forderungsmodul (Komplett-Check 2026-11-27, Nachprüfung)
--
-- Befunde:
--   Ereignisprotokoll claim_events ..... D3a-10, D2-18, D1a-10, H1-07
--     -> Positivliste: ohne RPC nur eigene Notizen änderbar/löschbar; alle übrigen Einträge
--        (Anlage, Mahnung, Frist, Status, Storno, Zahlung, Ratenplan, Systemnotizen) bleiben.
--        reverse_appended_claim behält den Nachtrags-Eintrag (doppelte Rückabwicklung gesperrt).
--        Tote Funktion block_claim_events_update() entfernt.
--   Position löschen ................... D1a-07 (Statusprüfung, letzte Position)
--   Erlass/Ausbuchung .................. D1b-13, H2-07 (allocation_type 'waiver', Sichten
--                                         weisen waived_principal / principal_waived aus)
--   Überzuordnung ...................... R2-06 (Prüfung in check_claim_allocation_integrity),
--                                         D4-16 (CHECK chk_bucket_item_id besteht live bereits)
--   Doppelanmahnung .................... R2-11 (Advisory-Locks, Prüfung beim Wiederöffnen)
--   Alt-RPCs ........................... D1a-17, R2-15, R2-16 (gelöscht; Rückbau in rollback/)
--   Mitnutzer .......................... G16-12 (update_overdue_claims_status, sync_all_rent_ledgers)
--   Ratenplan-Zuordnung ................ G15-13 (claim_items.created_at serverseitig, unveränderlich)
--   Mietkonto-Spiegel .................. D1b-18, H4-20, H1-10, H4-16, rent_payments.claim_payment_id
--   Stripe-Erstattung .................. E3-07 (reverse_claim_payment für die Server-Rolle)
--   Reproduzierbarkeit ................. D1b-23 (protect_claim_item_original_amount,
--                                         verify_payment_allocations_sum + Trigger), D1a-18
--                                         (invoice_counters) – auf Live jeweils ein No-op
--
-- Grundlage: Live-Stand am 27.11.2026. Die Funktionsrümpfe sind identisch mit
--   immo-web/supabase/migrations/20261127191718_money_claims.sql (md5 geprüft);
--   sync_all_rent_ledgers entspricht der Live-Fassung (weicht von 20261127185857_rent_history.sql ab).
-- Signaturen unverändert. Idempotent. Mit der heute ausgelieferten App verträglich
--   (Details im Bericht _fixwork/wave3/reports/01_CLAIMS-DB.md).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A. Schema
-- -----------------------------------------------------------------------------

-- A1. Erlass/Ausbuchung als eigene Zuordnungsart (D1b-13, H2-07)
alter table public.claim_payments drop constraint if exists claim_payments_allocation_type_check;
alter table public.claim_payments add constraint claim_payments_allocation_type_check
  check (allocation_type = any (array['automatic'::text, 'manual'::text, 'debtor_designated'::text,
                                      'reversal'::text, 'waiver'::text]));

-- A2. Verknüpfung Mietzahlung -> Forderungszahlung (H1-10, H4-16, rent_payments.claim_payment_id).
--     1:n (eine Forderungszahlung kann mehrere Monate verrechnen), daher auf rent_payments.
alter table public.rent_payments add column if not exists claim_payment_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.rent_payments'::regclass
                    and conname = 'rent_payments_claim_payment_id_fkey') then
    alter table public.rent_payments
      add constraint rent_payments_claim_payment_id_fkey
      foreign key (claim_payment_id) references public.claim_payments(id) on delete restrict;
  end if;
end $$;

create index if not exists idx_rent_payments_claim_payment_id
  on public.rent_payments (claim_payment_id) where claim_payment_id is not null;

comment on column public.rent_payments.claim_payment_id is
  'Forderungszahlung, aus der diese Mietzahlung gespiegelt wurde (gesetzt nur von record_claim_payment). Die Notiz "Verrechnung Forderungsakte (Ref: …)" ist reiner Anzeigetext.';

-- A3. Mahnkosten einer Forderung nie negativ (R2-16, optional) – nur wenn der Bestand passt
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.claims'::regclass
                    and conname = 'claims_accumulated_unpaid_fees_check') then
    if exists (select 1 from public.claims where accumulated_unpaid_fees < 0) then
      raise warning 'CLAIMS-DB: claims enthält negative Mahnkosten – CHECK claims_accumulated_unpaid_fees_check nicht angelegt.';
    else
      alter table public.claims
        add constraint claims_accumulated_unpaid_fees_check check (accumulated_unpaid_fees >= 0);
    end if;
  end if;
end $$;

-- A4. invoice_counters reproduzierbar (D1a-18). Entspricht dem Live-Stand (Spalten, PK,
--     UNIQUE NULLS NOT DISTINCT aus schema_integrity, FKs); Policies stehen in
--     20261127183348_sec_table_policies_1.sql. Auf Live ein No-op.
create table if not exists public.invoice_counters (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  portfolio_id uuid not null,
  year integer not null,
  last_number integer not null default 0,
  created_at timestamptz default now(),
  object_unit_id uuid,
  constraint invoice_counters_pkey primary key (id),
  constraint invoice_counters_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint invoice_counters_portfolio_id_fkey foreign key (portfolio_id) references public.portfolios(id) on delete cascade,
  constraint invoice_counters_unique_portfolio_year_object unique nulls not distinct (portfolio_id, year, object_unit_id)
);
alter table public.invoice_counters enable row level security;
revoke all on public.invoice_counters from anon;


-- -----------------------------------------------------------------------------
-- B. Forderungs-Sichten: Erlass getrennt ausweisen (H2-07, D1b-13)
--    Bestehende Spalten unverändert (paid_principal / principal_paid = durch Zahlung ODER
--    Erlass getilgt, wie bisher – die heute ausgelieferte App rechnet damit). Neu am Ende:
--    waived_principal bzw. principal_waived = davon durch Erlass/Ausbuchung (kein Geldeingang).
-- -----------------------------------------------------------------------------
create or replace view public.claim_item_totals_view
with (security_invoker = true)
as
 with posted_allocations as (
         select cpa.claim_item_id,
            sum(cpa.amount) as paid_principal,
            sum(cpa.amount) filter (where cp.allocation_type = 'waiver'::text) as waived_principal
           from public.claim_payment_allocations cpa
             join public.claim_payments cp on cp.id = cpa.claim_payment_id
          where cp.status = 'posted'::text and cpa.allocation_bucket = 'principal'::text
          group by cpa.claim_item_id
        )
 select ci.id as claim_item_id,
    ci.claim_id,
    ci.user_id,
    ci.original_amount,
    coalesce(pa.paid_principal, 0::numeric) as paid_principal,
    greatest(0::numeric, ci.original_amount - coalesce(pa.paid_principal, 0::numeric)) as open_amount,
    coalesce(pa.waived_principal, 0::numeric) as waived_principal
   from public.claim_items ci
     left join posted_allocations pa on pa.claim_item_id = ci.id;

comment on view public.claim_item_totals_view is
  'Je Position: paid_principal = getilgt (Zahlung oder Erlass), waived_principal = davon Erlass/Ausbuchung ohne Geldeingang, open_amount = offen.';

create or replace view public.claim_totals_view
with (security_invoker = true)
as
 with allocation_sums as (
         select cp.claim_id,
            sum(cpa.amount) filter (where cpa.allocation_bucket = 'principal'::text) as principal_paid,
            sum(cpa.amount) filter (where cpa.allocation_bucket = 'fees'::text) as fees_paid,
            sum(cpa.amount) filter (where cpa.allocation_bucket = 'interest'::text) as interest_paid,
            sum(cpa.amount) filter (where cpa.allocation_bucket = 'principal'::text
                                      and cp.allocation_type = 'waiver'::text) as principal_waived
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
      + greatest(0::numeric, c.accumulated_unpaid_interest + li.live_interest) as total_due,
    coalesce(a.principal_waived, 0::numeric) as principal_waived
   from public.claims c
     left join item_sums i on c.id = i.claim_id
     left join allocation_sums a on c.id = a.claim_id
     cross join lateral (
       select coalesce(public.claim_live_interest(c.id, current_date), 0::numeric) as live_interest
     ) li;

comment on view public.claim_totals_view is
  'Summen je Forderung. principal_paid = getilgt (Zahlung oder Erlass), principal_waived = davon Erlass/Ausbuchung ohne Geldeingang.';

-- D4-16: Die Zinsformel bleibt bewusst vereinfacht (dokumentiert, nicht geändert).
comment on function public.claim_interest_amount(numeric, numeric, date, date) is
  'Einzige Zinsformel des Forderungsmoduls: Kapital x Satz/100 x Tage/365, auf Cent gerundet. Bewusste Vereinfachung: immer 365 Tage (auch in Schaltjahren), Stichtag der Sichten ist CURRENT_DATE der Datenbank.';


-- -----------------------------------------------------------------------------
-- C. Ereignisprotokoll claim_events (D3a-10, D2-18, D1a-10, H1-07)
--    Ohne RPC-Bypass gilt eine Positivliste:
--      UPDATE: nur eigene Notizen (note_added ohne Systemquelle/Positionsbezug) inhaltlich,
--              sowie das Entfernen eines gelöschten Dokuments (FK ON DELETE SET NULL).
--      DELETE: nur eigene Notizen.
--    Die Forderungs-RPCs (app.claims_rpc_bypass = '1') bleiben unberührt.
-- -----------------------------------------------------------------------------
create or replace function public.block_claim_events_modification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_own_note boolean;
begin
  if current_setting('app.claims_rpc_bypass', true) = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- Eigene Notiz: note_added ohne Systemquelle und ohne Positionsbezug (z. B. "Position gelöscht")
  v_own_note := old.event_type = 'note_added'
                and coalesce(old.event_metadata->>'source', '') = ''
                and not (coalesce(old.event_metadata, '{}'::jsonb) ? 'item_id');

  if tg_op = 'UPDATE' then
    if to_jsonb(new) = to_jsonb(old) then
      return new;
    end if;
    -- Ein verknüpftes Dokument wurde gelöscht (claim_events.document_id ON DELETE SET NULL)
    if new.document_id is null
       and (to_jsonb(new) - 'document_id') = (to_jsonb(old) - 'document_id') then
      return new;
    end if;
    -- Eigene Notizen dürfen korrigiert werden; Typ, Forderung, Verfasser und Datum bleiben
    if v_own_note
       and new.event_type = 'note_added'
       and coalesce(new.event_metadata->>'source', '') = ''
       and not (coalesce(new.event_metadata, '{}'::jsonb) ? 'item_id')
       and (to_jsonb(new) - array['description', 'event_metadata', 'document_id'])
         = (to_jsonb(old) - array['description', 'event_metadata', 'document_id']) then
      return new;
    end if;
    raise exception 'Einträge der Forderungshistorie können nicht geändert werden. Bitte ergänzen Sie stattdessen eine Notiz.';
  end if;

  -- DELETE
  if v_own_note then
    return old;
  end if;
  if old.event_type = 'payment_received' then
    raise exception 'Zahlungsbuchungen bleiben in der Forderungshistorie erhalten. Eine Zahlung wird storniert, nicht gelöscht.';
  elsif old.event_type = 'payment_plan_accepted' then
    raise exception 'Ratenzahlungsvereinbarungen bleiben in der Forderungshistorie erhalten. Ein Ratenplan wird aufgehoben, nicht gelöscht.';
  end if;
  raise exception 'Einträge der Forderungshistorie (z. B. Anlage, Mahnungen, Fristen, Statuswechsel, Zahlungen, Stornos) können nicht gelöscht werden. Löschbar sind nur eigene Notizen.';
end;
$function$;

drop trigger if exists trigger_protect_claim_events on public.claim_events;
create trigger trigger_protect_claim_events
  before update or delete on public.claim_events
  for each row execute function public.block_claim_events_modification();

-- Tote Funktion ohne Trigger (D2-18, D1a-10)
drop function if exists public.block_claim_events_update();


-- -----------------------------------------------------------------------------
-- D. Integritäts-Trigger
-- -----------------------------------------------------------------------------

-- D1. Zuordnungen: Zugehörigkeit (wie bisher) + keine Überzuordnung (R2-06).
--     Gezählt werden die Zuordnungen aller nicht stornierten Zahlungen (gebucht und Entwurf).
--     Hauptforderung je Position <= Positionsbetrag, Mahnkosten je Forderung <= gebuchte
--     Mahnkosten. Zinsen werden nicht geprüft (accumulated_unpaid_interest ist netto).
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
  v_item_amount numeric;
  v_fees numeric;
  v_sum numeric;
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

  -- 4. Keine Überzuordnung (R2-06). Die Zeilensperre serialisiert gleichzeitige Zuordnungen.
  if new.amount > 0 and new.allocation_bucket = 'principal' and new.claim_item_id is not null then
    select original_amount into v_item_amount
      from public.claim_items where id = new.claim_item_id
       for no key update;
    select coalesce(sum(a.amount), 0) into v_sum
      from public.claim_payment_allocations a
      join public.claim_payments cp on cp.id = a.claim_payment_id
     where a.claim_item_id = new.claim_item_id
       and a.allocation_bucket = 'principal'
       and cp.status <> 'cancelled'
       and a.id <> new.id;
    if v_sum + new.amount > coalesce(v_item_amount, 0) + 0.005 then
      raise exception 'Die Zuordnung (% EUR) übersteigt den offenen Betrag der Position (% EUR).',
        public.claim_format_eur(new.amount),
        public.claim_format_eur(greatest(0, coalesce(v_item_amount, 0) - v_sum));
    end if;
  elsif new.amount > 0 and new.allocation_bucket = 'fees' then
    select accumulated_unpaid_fees into v_fees
      from public.claims where id = new.claim_id
       for no key update;
    select coalesce(sum(a.amount), 0) into v_sum
      from public.claim_payment_allocations a
      join public.claim_payments cp on cp.id = a.claim_payment_id
     where a.claim_id = new.claim_id
       and a.allocation_bucket = 'fees'
       and cp.status <> 'cancelled'
       and a.id <> new.id;
    if v_sum + new.amount > coalesce(v_fees, 0) + 0.005 then
      raise exception 'Die Zuordnung auf Mahnkosten (% EUR) übersteigt die offenen Mahnkosten der Forderung (% EUR).',
        public.claim_format_eur(new.amount),
        public.claim_format_eur(greatest(0, coalesce(v_fees, 0) - v_sum));
    end if;
  end if;

  return new;
end;
$function$;

-- D2. Doppelte Anmahnung: Prüfung wie bisher, zusätzlich je Mietzeile ein transaktionsweiter
--     Advisory-Lock (sortiert), damit parallele Inserts nacheinander prüfen (R2-11).
create or replace function public.check_duplicate_active_claim_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ids uuid[];
  v_x uuid;
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
     where x is not null
     order by x);

  if cardinality(v_ids) = 0 then
    return new;
  end if;

  foreach v_x in array v_ids
  loop
    perform pg_advisory_xact_lock(hashtextextended('claim_rent_ledger:' || v_x::text, 0));
  end loop;

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

-- D3. Wiederöffnen einer abgeschlossenen Forderung (Status cancelled/archived/settled ->
--     aktiv, auch durch das Storno einer Zahlung) nur, wenn ihre Mietmonate in keiner
--     anderen aktiven Forderung stecken (R2-11).
create or replace function public.check_claim_reactivation_duplicates()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_x uuid;
  v_dup uuid;
  v_dup_period date;
begin
  if old.status not in ('cancelled', 'archived', 'settled')
     or new.status in ('cancelled', 'archived', 'settled') then
    return new;
  end if;

  for v_x in
    select distinct t.x
      from public.claim_items ci
      cross join lateral unnest(array_append(coalesce(ci.rent_ledger_ids, '{}'::uuid[]), ci.rent_ledger_id)) as t(x)
     where ci.claim_id = new.id
       and t.x is not null
     order by t.x
  loop
    perform pg_advisory_xact_lock(hashtextextended('claim_rent_ledger:' || v_x::text, 0));
  end loop;

  select t.x into v_dup
    from public.claim_items ci
    cross join lateral unnest(array_append(coalesce(ci.rent_ledger_ids, '{}'::uuid[]), ci.rent_ledger_id)) as t(x)
   where ci.claim_id = new.id
     and t.x is not null
     and exists (
       select 1
         from public.claim_items o
         join public.claims c on c.id = o.claim_id
        where o.claim_id <> new.id
          and c.status not in ('cancelled', 'archived', 'settled')
          and (o.rent_ledger_id = t.x or t.x = any(o.rent_ledger_ids)))
   limit 1;

  if v_dup is not null then
    select period_month into v_dup_period from public.rent_ledger where id = v_dup;
    raise exception 'Die Forderung kann nicht wieder geöffnet werden: Für die Miete % besteht inzwischen eine andere aktive Forderung.',
      coalesce(to_char(v_dup_period, 'MM/YYYY'), v_dup::text);
  end if;

  return new;
end;
$function$;

drop trigger if exists trigger_check_claim_reactivation on public.claims;
create trigger trigger_check_claim_reactivation
  before update of status on public.claims
  for each row execute function public.check_claim_reactivation_duplicates();

-- D4. Zuordnung Position <-> Ratenplan läuft über claim_items.created_at (Positionen bis zur
--     Plananlage gehören zum Plan). Der Zeitstempel wird daher vom Server gesetzt und ist
--     unveränderlich – keine Rückdatierung über die API (G15-13).
create or replace function public.protect_claim_item_created_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$function$;

drop trigger if exists trigger_protect_claim_item_created_at on public.claim_items;
create trigger trigger_protect_claim_item_created_at
  before insert or update on public.claim_items
  for each row execute function public.protect_claim_item_created_at();

-- D5. Forderungsgebundene Mietzahlungen (H1-10, H4-16): Bindung über claim_payment_id,
--     Notiz-Erkennung nur noch für Altzeilen. Die Bindung setzt nur record_claim_payment;
--     geschützt, solange die Forderungszahlung gebucht ist.
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

  -- Die Verknüpfung setzt/ändert nur die Forderungsbuchung (record_claim_payment)
  if tg_op in ('INSERT', 'UPDATE')
     and new.claim_payment_id is not null
     and (tg_op = 'INSERT' or new.claim_payment_id is distinct from old.claim_payment_id)
     and coalesce(current_setting('app.claims_rpc_bypass', true), '') <> '1' then
    raise exception 'Die Verknüpfung mit einer Forderungszahlung wird ausschließlich von der Forderungsakte gesetzt.';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.claim_payment_id is not null then
    v_linked := exists (select 1 from public.claim_payments cp
                         where cp.id = old.claim_payment_id and cp.status = 'posted');
  elsif old.note is not null and old.note like '%Verrechnung%Forderungsakte%' then
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
     or new.user_id is distinct from old.user_id
     or new.claim_payment_id is distinct from old.claim_payment_id then
    raise exception 'Eine forderungsgebundene Zahlung kann nicht manuell in der Buchhaltung geändert werden. Bitte stornieren Sie die Zahlung in der zugehörigen Forderungsakte.';
  end if;
  return new;
end;
$function$;

drop trigger if exists block_claim_rent_payments_modification on public.rent_payments;
create trigger block_claim_rent_payments_modification
  before insert or update or delete on public.rent_payments
  for each row execute function public.protect_claim_rent_payments();

-- D6. Reproduzierbarkeit (D1b-23): Live-Fassungen, bisher nur in archive/sql/draft_claims_migration_v3/v4.sql.
--     Inhalt unverändert (nur Zeilenenden); auf Live ein No-op.
create or replace function public.protect_claim_item_original_amount()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
DECLARE
  v_posted_count int;
BEGIN
  IF NEW.original_amount != OLD.original_amount THEN
    SELECT COUNT(*) INTO v_posted_count
    FROM claim_payment_allocations cpa
    JOIN claim_payments cp ON cp.id = cpa.claim_payment_id
    WHERE cpa.claim_item_id = OLD.id AND cp.status = 'posted';

    IF v_posted_count > 0 THEN
      RAISE EXCEPTION 'original_amount cannot be changed after payments have been posted to this item. Use reversal or new items.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

create or replace function public.verify_payment_allocations_sum()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
DECLARE
  v_payment_amount numeric;
  v_allocations_sum numeric;
  v_check_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'claim_payments' THEN
    IF TG_OP = 'DELETE' THEN
      v_check_id := OLD.id;
    ELSE
      v_check_id := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_check_id := OLD.claim_payment_id;
    ELSE
      v_check_id := NEW.claim_payment_id;
    END IF;
  END IF;

  SELECT amount INTO v_payment_amount FROM claim_payments WHERE id = v_check_id AND status = 'posted';

  IF v_payment_amount IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_allocations_sum FROM claim_payment_allocations WHERE claim_payment_id = v_check_id;
    IF v_allocations_sum != v_payment_amount THEN
      RAISE EXCEPTION 'Sum of allocations (%) does not match claim_payment amount (%) for posted payment ID %.', v_allocations_sum, v_payment_amount, v_check_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

drop trigger if exists trigger_protect_claim_item_original_amount on public.claim_items;
create trigger trigger_protect_claim_item_original_amount
  before update on public.claim_items
  for each row execute function public.protect_claim_item_original_amount();

drop trigger if exists check_payment_allocations_after_allocation on public.claim_payment_allocations;
create constraint trigger check_payment_allocations_after_allocation
  after insert or delete or update on public.claim_payment_allocations
  deferrable initially deferred
  for each row execute function public.verify_payment_allocations_sum();

drop trigger if exists check_payment_allocations_after_payment on public.claim_payments;
create constraint trigger check_payment_allocations_after_payment
  after insert or update on public.claim_payments
  deferrable initially deferred
  for each row execute function public.verify_payment_allocations_sum();


-- -----------------------------------------------------------------------------
-- E. record_claim_payment (Basis: Live = money_claims.sql)
--    D1b-18: nur Mietpositionen (item_type 'rent') werden ins Mietkonto gespiegelt;
--            je Monat höchstens bis zur Sollmiete, Rest als rent_mirror_unbooked im Ereignis.
--    H4-16 : Mietzeilen nur des Eigentümers und dieses Vertrags; Bindung über claim_payment_id.
--    H4-20 : kein sync_all_rent_ledgers() mehr – das Mietkonto aktualisiert der Trigger
--            on_rent_payment_change je betroffenem Monat.
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
  v_rent_unbooked numeric := 0;
  v_rl_ids uuid[];
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
    select ci.id, ci.item_type, ci.period_month, ci.rent_ledger_id, ci.rent_ledger_ids, ctv.open_amount,
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
        'item_id', v_item.id, 'amount', v_item_alloc, 'item_type', v_item.item_type,
        'period_month', v_item.period_month,
        'rent_ledger_ids', to_jsonb(array(
           select distinct x
             from unnest(array_append(coalesce(v_item.rent_ledger_ids, '{}'::uuid[]), v_item.rent_ledger_id)) as t(x)
            where x is not null))));
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

    -- Mietkonto spiegeln (D1b-18, H1-10, H4-16): nur Mietpositionen, nur Mietzeilen des
    -- Eigentümers und dieses Vertrags; Bindung über rent_payments.claim_payment_id (die Notiz
    -- bleibt reiner Anzeigetext). Je Monat höchstens bis zur Sollmiete – ein Rest wird bewusst
    -- NICHT ins Mietkonto gebucht (die Miete wäre sonst überzahlt), sondern im Ereignis als
    -- rent_mirror_unbooked ausgewiesen. Altpositionen ohne Mietzeilen-Bezug: Monat aus period_month.
    if v_claim.lease_id is not null and coalesce(v_alloc->>'item_type', '') = 'rent' then
      v_rent_remaining := (v_alloc->>'amount')::numeric;
      v_rl_ids := case when jsonb_typeof(v_alloc->'rent_ledger_ids') = 'array'
                       then array(select t.v::uuid from jsonb_array_elements_text(v_alloc->'rent_ledger_ids') as t(v))
                       else '{}'::uuid[] end;
      for v_rl in
        select rl.id, rl.period_month, rl.expected_rent, coalesce(rl.paid_amount, 0) as paid_amount
          from public.rent_ledger rl
         where rl.user_id = v_owner
           and rl.lease_id = v_claim.lease_id
           and (rl.id = any(v_rl_ids)
                or (cardinality(v_rl_ids) = 0
                    and v_alloc->>'period_month' is not null
                    and rl.period_month = date_trunc('month', (v_alloc->>'period_month')::date)::date))
         order by rl.period_month asc
      loop
        exit when v_rent_remaining <= 0;
        v_rl_alloc := least(v_rent_remaining, v_rl.expected_rent - v_rl.paid_amount);
        if v_rl_alloc > 0 then
          insert into public.rent_payments (user_id, lease_id, payment_date, period_month, amount, note, claim_payment_id)
          values (v_owner, v_claim.lease_id, p_payment_date, v_rl.period_month, v_rl_alloc,
                  'Verrechnung Forderungsakte (Ref: ' || v_payment_id || ')', v_payment_id);
          v_rent_remaining := v_rent_remaining - v_rl_alloc;
        end if;
      end loop;
      if v_rent_remaining > 0 then
        v_rent_unbooked := v_rent_unbooked + v_rent_remaining;
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

  if v_rent_unbooked > 0 then
    v_event_metadata := v_event_metadata || jsonb_build_object('rent_mirror_unbooked', round(v_rent_unbooked, 2));
  end if;

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
end;
$function$;


-- -----------------------------------------------------------------------------
-- F. reverse_claim_payment (Basis: Live = money_claims.sql)
--    E3-07: auch für die Server-Rolle (Stripe-Webhook bei Erstattung/Rückbuchung);
--           Berechtigungsprüfung nur für angemeldete Aufrufer.
--    H1-10/H4-16: gespiegelte Mietzahlungen über claim_payment_id (Notiz nur für Altzeilen).
--    H4-20: kein sync_all_rent_ledgers() mehr.
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
  -- Angemeldeter Nutzer oder Server-Rolle (Stripe-Webhook: Erstattung/Rückbuchung)
  if v_caller is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  select * into v_pay from public.claim_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Zahlung nicht gefunden oder keine Berechtigung.';
  end if;

  -- Berechtigung auf die FORDERUNG (nicht nur auf die Zahlungszeile)
  select * into v_claim from public.claims where id = v_pay.claim_id for update;
  if not found
     or (v_caller is not null
         and v_claim.user_id <> v_caller
         and not public.has_claim_access(v_claim.id, 'finanzen', 'write')) then
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

  -- Gespiegelte Mietzahlungen entfernen (Mietkonto zeigt den Rückstand wieder).
  -- Verknüpfung über claim_payment_id; Altzeilen ohne Verknüpfung über den Notiztext.
  perform set_config('app.bypass_rent_payment_protect', '1', true);
  delete from public.rent_payments
   where user_id = v_claim.user_id
     and (claim_payment_id = p_payment_id
          or (claim_payment_id is null
              and note like '%(Ref: ' || p_payment_id::text || ')%'));
  perform set_config('app.bypass_rent_payment_protect', '', true);

  -- Zahlung bleibt als storniert erhalten; Zuordnungen werden entfernt (sie stehen im
  -- Storno-Ereignis), damit Positionen später gelöscht werden können.
  delete from public.claim_payment_allocations where claim_payment_id = p_payment_id;
  update public.claim_payments set status = 'cancelled' where id = p_payment_id;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (coalesce(v_caller, v_claim.user_id), v_claim.id, 'payment_reversed', 'Zahlung storniert',
      jsonb_build_object(
          'payment_id', p_payment_id,
          'amount', v_pay.amount,
          'original_payment_date', v_pay.payment_date,
          'reversal_date', current_date,
          'reason', case when v_caller is null
                         then 'Automatisch storniert (Erstattung/Rückbuchung beim Zahlungsdienstleister)'
                         else 'Manuell storniert' end,
          'reversed_by', v_caller,
          'waiver', v_pay.allocation_type = 'waiver',
          'reversed_fees', v_alloc_fees,
          'reversed_interest', v_alloc_interest,
          'reversed_principal', v_alloc_principal,
          'reversed_allocations', v_reversed_allocs,
          'interest_correction', v_correction,
          'old_claim_status', v_claim.status,
          'new_claim_status', v_new_status));

  perform set_config('app.claims_rpc_bypass', '', true);
end;
$function$;


-- -----------------------------------------------------------------------------
-- G. reverse_appended_claim (Basis: Live = money_claims.sql)
--    H1-07: Der Nachtrags-Eintrag bleibt in der Historie (wird nicht mehr gelöscht); eine
--    zweite Rückabwicklung desselben Nachtrags wird abgelehnt.
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

  -- Der Nachtrags-Eintrag bleibt erhalten; nur einmal rückgängig machen
  if exists (select 1 from public.claim_events r
              where r.claim_id = v_claim.id
                and r.event_type = 'note_added'
                and r.event_metadata->>'source' = 'append_reversed'
                and r.event_metadata->>'reversed_event_id' = p_event_id::text) then
    raise exception 'Dieser Nachtrag wurde bereits rückgängig gemacht.';
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

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (v_caller, v_claim.id, 'note_added', 'Nachtrag rückgängig gemacht',
      jsonb_build_object('source', 'append_reversed', 'reversed_event_id', p_event_id,
                         'deleted_item_ids', to_jsonb(v_ids), 'fee_removed', coalesce(v_claim.accumulated_unpaid_fees, 0) - v_new_fees,
                         'interest_removed', v_interest, 'items', v_ev.event_metadata->'items'));

  perform set_config('app.claims_rpc_bypass', '', true);
end;
$function$;


-- -----------------------------------------------------------------------------
-- H. settle_claim_item (Basis: Live = money_claims.sql)
--    D1b-13, H2-07: Erlass wird als allocation_type 'waiver' gebucht (kein Geldeingang).
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

  -- Erlass/Ausbuchung: eigene Zuordnungsart 'waiver' (kein Geldeingang)
  insert into public.claim_payments (user_id, claim_id, payment_date, amount, allocation_type, status, note)
  values (v_claim.user_id, v_claim_id, current_date, v_open, 'waiver', 'posted', 'Als erledigt markiert (Erlass/Ausbuchung)')
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
          'allocation_type', 'waiver',
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
-- I. delete_claim_item (Basis: Live = money_claims.sql)
--    D1a-07: keine Löschung bei abgeschlossenen Forderungen und nicht die letzte Position
--    (sonst bliebe eine leere Forderung). Gebühr/Zinsen der Position gehen wie bisher auf die
--    älteste verbleibende Position über.
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

  if v_claim.status in ('settled', 'cancelled', 'archived') then
    raise exception 'Bei abgeschlossenen Forderungen können keine Positionen gelöscht werden (Status: %).',
      case v_claim.status when 'settled' then 'erledigt' when 'cancelled' then 'storniert' else 'archiviert' end;
  end if;

  if exists (select 1 from public.claim_payment_allocations where claim_item_id = p_item_id) then
    raise exception 'Diese Position hat bereits zugeordnete Zahlungen. Bitte zuerst die Zahlungen rückabwickeln.';
  end if;

  select max(created_at) into v_plan_created
    from public.payment_plans where claim_id = v_item.claim_id and status = 'active';
  if v_plan_created is not null and coalesce(v_item.created_at, '-infinity'::timestamptz) <= v_plan_created then
    raise exception 'Diese Position ist Teil einer aktiven Ratenzahlungsvereinbarung. Bitte den Ratenplan zuerst rückgängig machen.';
  end if;

  select id into v_other
    from public.claim_items
   where claim_id = v_item.claim_id and id <> p_item_id
   order by created_at asc nulls first, id
   limit 1;
  if v_other is null then
    raise exception 'Die letzte Position einer Forderung kann nicht gelöscht werden. Bitte stornieren Sie stattdessen die Forderung.';
  end if;

  -- Gebühr/Zinsen der Position auf die älteste verbleibende Position übertragen
  if coalesce(v_item.fee_amount, 0) > 0 or coalesce(v_item.interest_amount, 0) > 0 then
    update public.claim_items set
      fee_amount = fee_amount + coalesce(v_item.fee_amount, 0),
      interest_amount = interest_amount + coalesce(v_item.interest_amount, 0)
    where id = v_other;
    v_moved_to := v_other;
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
-- J. Mitnutzer (G16-12)
--    update_overdue_claims_status: auch Forderungen, auf die der Aufrufer Schreibrecht
--    „finanzen" hat; Ereignis unter dem Eigentümer, Aufrufer in den Metadaten.
--    sync_all_rent_ledgers (Basis: Live-Fassung): auch Verträge freigegebener Portfolios,
--    sofern can_write_rent_ledger (Schreibrecht mietverhaeltnisse oder finanzen).
-- -----------------------------------------------------------------------------
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

  -- skip locked: läuft dieselbe Prüfung parallel (z. B. Eigentümer und Mitnutzer), wird jede
  -- Forderung nur einmal umgestellt und protokolliert.
  for claim_record in
    select c.id, c.status, c.user_id
      from public.claims c
     where c.status in ('sent', 'open')
       and c.deadline < current_date
       and (c.user_id = current_user_id
            or public.has_claim_access(c.id, 'finanzen', 'write'))
       for update of c skip locked
  loop
    v_old_status := claim_record.status;
    update public.claims set status = 'action_required' where id = claim_record.id;

    insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
    values (
      claim_record.user_id,
      claim_record.id,
      'deadline_expired',
      'Die gesetzte Frist ist abgelaufen. Status wurde automatisch auf Aktion erforderlich gesetzt.',
      jsonb_build_object('old_status', v_old_status, 'new_status', 'action_required',
                         'triggered_by', current_user_id)
    );
    updated_count := updated_count + 1;
  end loop;

  return updated_count;
end;
$function$;

create or replace function public.sync_all_rent_ledgers()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    v_user_id uuid;
    v_email text;
    v_lease record;
    v_current_month date;
    v_shared uuid[];
    v_lease_ids uuid[];
begin
    v_user_id := auth.uid();
    if v_user_id is null then
        return;
    end if;

    v_current_month := date_trunc('month', current_date)::date;
    v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

    -- Freigegebene Portfolios (angenommene Freigaben an die E-Mail des Aufrufers)
    v_shared := array(
        select distinct s.portfolio_id
          from public.portfolio_shares s
         where v_email <> ''
           and s.status = 'accepted'
           and lower(s.shared_with_email) = v_email);

    -- Eigene Verträge + Verträge freigegebener Portfolios mit Schreibrecht auf das Mietkonto
    v_lease_ids := array(
        select l.id
          from public.leases l
         where l.user_id = v_user_id
        union
        select l.id
          from public.leases l
          join public.units u on u.id = l.unit_id
          join public.properties pr on pr.id = u.property_id
         where cardinality(v_shared) > 0
           and pr.portfolio_id = any(v_shared)
           and l.user_id <> v_user_id
           and public.can_write_rent_ledger(l.id));

    if cardinality(v_lease_ids) = 0 then
        return;
    end if;

    update public.leases
       set status = 'ended'
     where id = any(v_lease_ids)
       and status = 'active'
       and end_date is not null
       and end_date < current_date;

    for v_lease in
        select id
          from public.leases
         where id = any(v_lease_ids)
           and start_date <= current_date
           and (end_date is null or end_date >= v_current_month)
    loop
        perform public.sync_lease_rent_from_periods(v_lease.id);

        if not exists (
            select 1 from public.rent_ledger
             where lease_id = v_lease.id and period_month = v_current_month
        ) then
            perform public.recalculate_rent_ledger_entry(v_lease.id, v_current_month);
        end if;
    end loop;
end;
$function$;


-- -----------------------------------------------------------------------------
-- K. Bestandsdaten (am 27.11.2026 jeweils 0 Zeilen betroffen)
-- -----------------------------------------------------------------------------
do $$
begin
  -- K1. Frühere Erlass-Buchungen als 'waiver' kennzeichnen (H2-07)
  perform set_config('app.claims_rpc_bypass', '1', true);
  update public.claim_payments cp
     set allocation_type = 'waiver'
   where cp.allocation_type = 'manual'
     and cp.note like 'Als erledigt markiert%'
     and exists (select 1 from public.claim_events e
                  where e.claim_id = cp.claim_id
                    and e.event_type = 'payment_received'
                    and e.event_metadata->>'payment_id' = cp.id::text
                    and (e.event_metadata->>'waiver' = 'true' or e.description ilike '%als erledigt markiert%'));
  perform set_config('app.claims_rpc_bypass', '', true);

  -- K2. Gespiegelte Mietzahlungen mit ihrer Forderungszahlung verknüpfen (H1-10, H4-16)
  perform set_config('app.bypass_rent_payment_protect', '1', true);
  update public.rent_payments rp
     set claim_payment_id = cp.id
    from public.claim_payments cp
   where rp.claim_payment_id is null
     and rp.note like '%Verrechnung%Forderungsakte%'
     and cp.user_id = rp.user_id
     and cp.id::text = lower(substring(rp.note from '\(Ref: ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)'));
  perform set_config('app.bypass_rent_payment_protect', '', true);
end $$;


-- -----------------------------------------------------------------------------
-- L. Ungenutzte Alt-RPCs entfernen (D1a-17, R2-15, R2-16). Keine Aufrufer in App, Edge
--    Functions, anderen DB-Funktionen oder Policies (pg_depend leer). Rückbau: rollback/.
-- -----------------------------------------------------------------------------
drop function if exists public.create_claim_from_rent_ledger(uuid, numeric, numeric, date, integer, text);
drop function if exists public.create_claim_from_rent_ledgers(uuid[], numeric, numeric, date, integer, text);
drop function if exists public.create_claim_from_rent_ledgers(uuid[], numeric, numeric, numeric, date, integer, text);


-- -----------------------------------------------------------------------------
-- M. Ausführungsrechte (CREATE OR REPLACE behält bestehende Rechte; neue Funktionen hätten
--    sonst EXECUTE für PUBLIC). Trigger-Funktionen: nur service_role.
-- -----------------------------------------------------------------------------
revoke execute on function public.check_claim_reactivation_duplicates() from public, anon, authenticated;
revoke execute on function public.protect_claim_item_created_at() from public, anon, authenticated;
revoke execute on function public.block_claim_events_modification() from public, anon, authenticated;
revoke execute on function public.check_claim_allocation_integrity() from public, anon, authenticated;
revoke execute on function public.check_duplicate_active_claim_item() from public, anon, authenticated;
revoke execute on function public.protect_claim_rent_payments() from public, anon, authenticated;
revoke execute on function public.protect_claim_item_original_amount() from public, anon, authenticated;
revoke execute on function public.verify_payment_allocations_sum() from public, anon, authenticated;
grant execute on function public.check_claim_reactivation_duplicates() to service_role;
grant execute on function public.protect_claim_item_created_at() to service_role;
grant execute on function public.block_claim_events_modification() to service_role;
grant execute on function public.check_claim_allocation_integrity() to service_role;
grant execute on function public.check_duplicate_active_claim_item() to service_role;
grant execute on function public.protect_claim_rent_payments() to service_role;
grant execute on function public.protect_claim_item_original_amount() to service_role;
grant execute on function public.verify_payment_allocations_sum() to service_role;

revoke execute on function public.record_claim_payment(uuid, date, numeric, text, uuid, text, uuid) from public, anon;
revoke execute on function public.reverse_claim_payment(uuid) from public, anon;
revoke execute on function public.reverse_appended_claim(uuid) from public, anon;
revoke execute on function public.settle_claim_item(uuid) from public, anon;
revoke execute on function public.delete_claim_item(uuid) from public, anon;
revoke execute on function public.update_overdue_claims_status() from public, anon;
revoke execute on function public.sync_all_rent_ledgers() from public, anon;
grant execute on function public.record_claim_payment(uuid, date, numeric, text, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.reverse_claim_payment(uuid) to authenticated, service_role;
grant execute on function public.reverse_appended_claim(uuid) to authenticated, service_role;
grant execute on function public.settle_claim_item(uuid) to authenticated, service_role;
grant execute on function public.delete_claim_item(uuid) to authenticated, service_role;
grant execute on function public.update_overdue_claims_status() to authenticated, service_role;
grant execute on function public.sync_all_rent_ledgers() to authenticated, service_role;

-- Sichten: Rechte bleiben bei CREATE OR REPLACE erhalten (authenticated, service_role; kein anon)
revoke all on public.claim_item_totals_view from anon;
revoke all on public.claim_totals_view from anon;
