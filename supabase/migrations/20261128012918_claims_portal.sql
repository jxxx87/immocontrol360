-- =============================================================================
-- Wave 3 · Paket 07 CLAIMS-PORTAL (27.11.2026)
--
-- Befunde:
--   G15-05, G17b-12, R1-08, D3a-16  Portal-Token und -PIN: Prüfung nur noch über die Hashes
--                                    (token_hash = SHA-256, pin_hash = bcrypt); neue RPC
--                                    create_claim_portal_link erzeugt Token/PIN serverseitig,
--                                    speichert KEINEN Klartext und gibt beides genau einmal zurück.
--   D1b-16                           Ein Kalendertag für Sichten und Buchungen: Europe/Berlin
--                                    (public.claim_today()) statt CURRENT_DATE der Datenbank (UTC).
--   G08-09                           Privater Bucket claim-documents für das Archiv der Mahnschreiben
--                                    (nur PDF, nur Anhängen, kein Ändern/Löschen).
--
-- VORAUSSETZUNG: _fixwork/sql/wave3/01_CLAIMS-DB.sql ist eingespielt (claim_totals_view und
--   settle_claim_item bauen auf dessen Fassung auf). Die Migration bricht sonst ab.
--
-- VERTRÄGLICH MIT DER HEUTE AUSGELIEFERTEN APP:
--   - generate_claim_access_link bleibt unverändert (schreibt weiter Hashes UND Klartext), die
--     alte App liest token/pin weiter aus der Tabelle; die Prüfung über die Hashes akzeptiert
--     auch Links der alten App (deren Hashes sind seit sec_functions echt).
--   - Alle 14 Bestandslinks sind inaktiv/abgelaufen (keine gültigen Hashes) – es bricht kein
--     laufender Link.
--   - Sicht: gleiche Spalten wie 01, nur der Stichtag ist jetzt der Berliner Kalendertag.
--
-- ABSCHLUSS erst NACH dem Ausrollen der neuen App (liest token/pin nicht mehr):
--   _fixwork/sql/wave3/deferred/07b_claims-portal-finalize.sql (Klartext löschen und sperren,
--   Spaltenrechte für authenticated einschränken).
--
-- Idempotent: mehrfaches Ausführen ist unschädlich.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.claim_payments'::regclass
                    and conname = 'claim_payments_allocation_type_check'
                    and pg_get_constraintdef(oid) like '%waiver%') then
    raise exception '01_CLAIMS-DB.sql ist nicht eingespielt – 07_claims-portal abgebrochen';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- A. D1b-16: Kalendertag des Forderungsmoduls
--    Die Datenbank läuft in UTC. CURRENT_DATE springt daher erst um 1 bzw. 2 Uhr Berliner
--    Zeit auf den neuen Tag, die App, das Portal und der Stripe-Webhook rechnen aber mit dem
--    Berliner Datum. Alle Zins-Stichtage des Moduls nutzen ab jetzt claim_today().
-- -----------------------------------------------------------------------------
create or replace function public.claim_today()
returns date
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select (now() at time zone 'Europe/Berlin')::date
$$;

comment on function public.claim_today() is
  'Heutiger Kalendertag des Forderungsmoduls (Europe/Berlin, Transaktionsbeginn). Stichtag für Zinsen in claim_totals_view und den Forderungs-RPCs (D1b-16).';

revoke all on function public.claim_today() from public, anon;
grant execute on function public.claim_today() to authenticated, service_role;


-- Sicht wie 01_CLAIMS-DB.sql (Erlass getrennt), Stichtag claim_today() statt current_date
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
       select coalesce(public.claim_live_interest(c.id, public.claim_today()), 0::numeric) as live_interest
     ) li;

comment on view public.claim_totals_view is
  'Summen je Forderung. principal_paid = getilgt (Zahlung oder Erlass), principal_waived = davon Erlass/Ausbuchung ohne Geldeingang. Zinsen bis claim_today() (Berliner Kalendertag).';

revoke all on public.claim_totals_view from anon;

comment on function public.claim_interest_amount(numeric, numeric, date, date) is
  'Einzige Zinsformel des Forderungsmoduls: Kapital x Satz/100 x Tage/365, auf Cent gerundet. Bewusste Vereinfachung: immer 365 Tage (auch in Schaltjahren). Stichtag der Sichten und RPCs ist claim_today() (Kalendertag Europe/Berlin).';


-- -----------------------------------------------------------------------------
-- B. D1b-16: Zins-Stichtage der RPCs ("Zinsen bis heute festschreiben") auf claim_today()
--    Sonst schreibt die RPC bis zum UTC-Tag fest, die Sicht rechnet aber bis zum Berliner Tag
--    weiter (zwischen 0 und 2 Uhr ein Tageszins zu viel bzw. eine Restforderung).
--    Rümpfe unverändert bis auf den Stichtag; Rechte (ACL) bleiben bei create or replace erhalten.
-- -----------------------------------------------------------------------------

-- settle_claim_item (Basis: 01_CLAIMS-DB.sql (Erlass als waiver)); einzige Änderung: 4x current_date -> public.claim_today()
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
  v_cap := coalesce(public.claim_live_interest(v_claim_id, public.claim_today()), 0);
  update public.claims set
    accumulated_unpaid_interest = round(coalesce(accumulated_unpaid_interest, 0) + v_cap, 2),
    interest_start_date = case when interest_start_date is null then null
                               else greatest(interest_start_date, public.claim_today()) end,
    updated_at = now()
  where id = v_claim_id;

  -- Erlass/Ausbuchung: eigene Zuordnungsart 'waiver' (kein Geldeingang)
  insert into public.claim_payments (user_id, claim_id, payment_date, amount, allocation_type, status, note)
  values (v_claim.user_id, v_claim_id, public.claim_today(), v_open, 'waiver', 'posted', 'Als erledigt markiert (Erlass/Ausbuchung)')
  returning id into v_payment_id;

  insert into public.claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, claim_item_id, amount)
  values (v_payment_id, v_claim.user_id, v_claim_id, 'principal', p_item_id, v_open);

  select round(coalesce(total_due, 0), 2) into v_total_due from public.claim_totals_view where claim_id = v_claim_id;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (v_caller, v_claim_id, 'payment_received', 'Position manuell als erledigt markiert (Erlass/Ausbuchung, kein Geldeingang)',
      jsonb_build_object(
          'payment_id', v_payment_id,
          'payment_date', public.claim_today(),
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

-- create_payment_plan (Basis: Live = 20261127191718_money_claims.sql); einzige Änderung: 2x current_date -> public.claim_today()
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
  v_cap := coalesce(public.claim_live_interest(p_claim_id, public.claim_today()), 0);
  v_fees_before := coalesce(v_claim.accumulated_unpaid_fees, 0);
  v_interest_after := round(coalesce(v_claim.accumulated_unpaid_interest, 0) + v_cap, 2);

  -- 2. Aufschlag als Gebühr auf die Forderung buchen (sonst ist die letzte Rate nicht buchbar)
  update public.claims set
    accumulated_unpaid_interest = v_interest_after,
    interest_start_date = case when interest_start_date is null then null
                               else greatest(interest_start_date, public.claim_today()) end,
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

-- reverse_payment_plan (Basis: Live = 20261127191718_money_claims.sql); einzige Änderung: 2x current_date -> public.claim_today()
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
  v_cap := coalesce(public.claim_live_interest(p_claim_id, public.claim_today()), 0);

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
                               else greatest(interest_start_date, public.claim_today()) end,
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

-- create_claim_advanced (Basis: Live = 20261127191718_money_claims.sql); einzige Änderung: 3x current_date -> public.claim_today()
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
  v_deadline := case when p_deadline_days is null then null else public.claim_today() + p_deadline_days end;

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
    v_cap := coalesce(public.claim_live_interest(v_claim_id, public.claim_today()), 0);

    update public.claims set
      accumulated_unpaid_interest = round(coalesce(accumulated_unpaid_interest, 0) + v_cap + v_interest, 2),
      accumulated_unpaid_fees = coalesce(accumulated_unpaid_fees, 0) + v_fee,
      interest_start_date = case when interest_start_date is null then null
                                 else greatest(interest_start_date, public.claim_today()) end,
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
-- C. G15-05, G17b-12, R1-08, D3a-16: Portal-Zugang nur noch über Hashes prüfen
--    Token: SHA-256 (hex) in token_hash, PIN: bcrypt in pin_hash (beides schreibt
--    generate_claim_access_link seit sec_functions; create_claim_portal_link unten ebenso).
--    Fehlversuchs-Sperre unverändert (5 in 15 Min., 10 seit der letzten Anmeldung -> Link gesperrt).
-- -----------------------------------------------------------------------------
create or replace function public.claim_portal_check_access(p_token text, p_pin text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_link public.claim_access_links%rowtype;
  v_token_hash text;
  v_pin_ok boolean := false;
  v_owner uuid;
  v_recent integer;
  v_since_success integer;
  c_window constant interval := interval '15 minutes';
  c_max_in_window constant integer := 5;
  c_max_total constant integer := 10;
begin
  if p_token is null or btrim(p_token) = '' or length(p_token) > 256 then
    return jsonb_build_object('ok', false, 'code', 'link_invalid',
      'error', 'Der Link ist ungültig. Bitte verwenden Sie den Link aus Ihrem Anschreiben.');
  end if;

  v_token_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');

  select l.* into v_link
    from public.claim_access_links l
   where l.token_hash = v_token_hash
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

  -- PIN nur gegen den bcrypt-Hash prüfen (kein Klartext-Vergleich)
  begin
    v_pin_ok := p_pin is not null
                and length(p_pin) <= 64
                and v_link.pin_hash is not null
                and extensions.crypt(btrim(p_pin), v_link.pin_hash) = v_link.pin_hash;
  exception when others then
    v_pin_ok := false;  -- kein gültiger bcrypt-Hash (Altbestand)
  end;

  if not v_pin_ok then
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
$function$;

comment on function public.claim_portal_check_access(text, text) is
  'Interne Prüfung des Mieterportal-Zugangs (Token-SHA-256 + PIN-bcrypt, Fehlversuchs-Sperre). Nur über get_public_claim_by_token / submit_public_payment_plan_request aufrufen.';

-- Nur intern (SECURITY-DEFINER-Aufrufer laufen als Eigentümer der Funktion); kein direkter Aufruf
revoke all on function public.claim_portal_check_access(text, text) from public, anon, authenticated;
grant execute on function public.claim_portal_check_access(text, text) to service_role;


-- Neuer Portal-Link: Token (192 Bit) und 6-stellige PIN werden serverseitig erzeugt, nur als
-- Hash gespeichert und genau einmal zurückgegeben. Alte Links der Forderung werden gesperrt.
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

  insert into public.claim_access_links (claim_id, token, pin, token_hash, pin_hash, expires_at, created_by, is_active)
  values (p_claim_id, null, null, v_token_hash, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)),
          v_expires, v_uid, true)
  returning id into v_link_id;

  return jsonb_build_object('link_id', v_link_id, 'token', v_token, 'pin', v_pin, 'expires_at', v_expires);
end;
$function$;

comment on function public.create_claim_portal_link(uuid, integer) is
  'Erzeugt einen Mieterportal-Link (Token + PIN) für eine Forderung. Gespeichert werden nur Hashes; Token und PIN werden nur in dieser Antwort geliefert (G15-05, G17b-12, R1-08, D3a-16).';

revoke all on function public.create_claim_portal_link(uuid, integer) from public, anon;
grant execute on function public.create_claim_portal_link(uuid, integer) to authenticated;


-- -----------------------------------------------------------------------------
-- D. G08-09: Archiv der Mahnschreiben (privater Bucket claim-documents)
--    Pfad: <claim_id>/<datei>.pdf (genau eine Ordnerebene).
--    Lesen und Hochladen: Eigentümer bzw. Mitnutzer mit Schreibrecht „finanzen“ – das
--    Schreiben enthält QR-Code und PIN des Mieterportals; wer nur lesen darf, soll die PIN
--    nicht erfahren (D3a-16). Kein UPDATE/DELETE: archivierte Schreiben sind unveränderlich.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('claim-documents', 'claim-documents', false, 10485760, array['application/pdf']::text[])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists claim_documents_read on storage.objects;
drop policy if exists claim_documents_insert on storage.objects;

create policy claim_documents_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'claim-documents'
    and public.has_claim_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'finanzen', 'write')
  );

create policy claim_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'claim-documents'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 1
    and lower(coalesce(storage.extension(objects.name), '')) = 'pdf'
    and public.has_claim_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'finanzen', 'write')
  );

notify pgrst, 'reload schema';
