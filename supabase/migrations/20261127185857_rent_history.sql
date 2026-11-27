-- =============================================================================
-- Paket RENT · Miethistorie „gültig ab" (Komplett-Check 2026-11-27, Thema 4.8)
--
-- Befunde:
--   D1b-01, G18-01  Soll wird bei jeder Vertragsänderung für ALLE Monate seit Mietbeginn
--                   mit der heutigen Miete überschrieben (Schein-Rückstände)
--   D1b-15          Neuberechnung per RPC ohne Berechtigungsprüfung
--   D3b-12          rent_ledger/rent_charges: Eigentümer sieht Buchungen von Mitnutzern
--                   nicht; Schreiben ohne Prüfung des Mietvertrags (nur user_id)
--   G18-06, G18-07  Sollstellungen nach rückdatiertem Vertragsende/vor verschobenem
--                   Mietbeginn bleiben als offene Rückstände stehen
--   G18-17          Fälligkeit rutscht bei Zahltag > Monatslänge in den Folgemonat
--   G17-04, G18-06  Status 'ended' wird erst nach Ablauf des Vertragsendes gesetzt
--   X2-07           gültige Fassung von sync_all_rent_ledgers ist jetzt versioniert
--
-- Inhalt:
--   1. Tabelle lease_rent_periods (Kaltmiete, NK, Heizkosten, Sonstiges, Zahltag je
--      Zeitraum ab valid_from) mit RLS (Eigentümer / Mitnutzer „mietverhaeltnisse")
--   2. Erstbefüllung: je Mietvertrag ein Zeitraum ab start_date mit den heutigen
--      Vertragswerten. Die heutigen Sollstellungen wurden vom bisherigen Trigger bereits
--      mit genau diesen Werten berechnet – die Erstbefüllung ändert keine Beträge.
--   3. Soll je Monat = Werte des für diesen Monat gültigen Zeitraums
--      (letzter Zeitraum mit Monat(valid_from) <= Monat; vor dem ersten Zeitraum gilt
--       der erste Zeitraum).
--   4. Trigger: Änderungen wirken nur noch ab dem angegebenen Datum.
--      - Neue/geänderte Zeiträume (App) -> Mietkonto wird neu berechnet, Vertragswerte
--        (leases.cold_rent usw.) werden auf den heute gültigen Zeitraum gesetzt.
--      - Direkte Änderung von Miete/NK/Zahltag am Vertrag (ältere App-Versionen) wirkt
--        ab dem laufenden Monat, bei noch nicht begonnenen Verträgen ab Mietbeginn –
--        nie mehr rückwirkend.
--      - Neuberechnung nur noch bei Änderung von Beginn/Ende/Miete/NK/Zahltag.
--   5. Policies rent_ledger / rent_charges über die rechte-bewussten Prüf-Funktionen.
--
-- Signaturen bestehender Funktionen bleiben unverändert.
-- Voraussetzung: 20261127100000_sec_access_helpers.sql (has_lease_access(uuid, text, text)).
-- Idempotent (mehrfach ausführbar).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Tabelle
-- -----------------------------------------------------------------------------
create table if not exists public.lease_rent_periods (
    id uuid primary key default gen_random_uuid(),
    lease_id uuid not null references public.leases(id) on delete cascade,
    valid_from date not null,
    cold_rent numeric not null default 0,
    service_charge numeric not null default 0,
    heating_cost numeric not null default 0,
    other_costs numeric not null default 0,
    payment_due_day integer not null default 3,
    created_by uuid default auth.uid() references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint lease_rent_periods_amounts_check
        check (cold_rent >= 0 and service_charge >= 0 and heating_cost >= 0 and other_costs >= 0),
    constraint lease_rent_periods_due_day_check
        check (payment_due_day between 1 and 31)
);

comment on table public.lease_rent_periods is
    'Miethistorie: Kaltmiete/NK/Heizkosten/Sonstiges/Zahltag je Mietvertrag, gültig ab valid_from (monatsgenau, ein Zeitraum je Monat).';

-- Ein Zeitraum je Mietvertrag und Kalendermonat (das Mietkonto ist monatsgenau)
create unique index if not exists lease_rent_periods_lease_month_uidx
    on public.lease_rent_periods (lease_id, (date_trunc('month', valid_from::timestamp)));
create index if not exists lease_rent_periods_lease_valid_idx
    on public.lease_rent_periods (lease_id, valid_from);

alter table public.lease_rent_periods enable row level security;

revoke all on table public.lease_rent_periods from anon;
grant select, insert, update, delete on table public.lease_rent_periods to authenticated;
grant all on table public.lease_rent_periods to service_role;


-- -----------------------------------------------------------------------------
-- 2. Prüf-Funktionen (für Policies und direkte RPC-Aufrufe)
-- -----------------------------------------------------------------------------

-- Miethistorie lesen: Eigentümer, Anleger des Vertrags, Mitnutzer mit Lese-/Schreibrecht „mietverhaeltnisse"
create or replace function public.can_read_lease_rent(p_lease_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and p_lease_id is not null
     and (
       exists (select 1 from public.leases l where l.id = p_lease_id and l.user_id = auth.uid())
       or public.has_lease_access(p_lease_id, 'mietverhaeltnisse', 'read')
     )
$$;

-- Miethistorie ändern: Eigentümer, Anleger des Vertrags, Mitnutzer mit Schreibrecht „mietverhaeltnisse"
create or replace function public.can_write_lease_rent(p_lease_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and p_lease_id is not null
     and (
       exists (select 1 from public.leases l where l.id = p_lease_id and l.user_id = auth.uid())
       or public.has_lease_access(p_lease_id, 'mietverhaeltnisse', 'write')
     )
$$;

-- Mietkonto (rent_ledger/rent_charges) lesen: zusätzlich Mitnutzer „finanzen"
-- (Forderungen und Finanzen arbeiten mit dem Mietkonto)
create or replace function public.can_read_rent_ledger(p_lease_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and p_lease_id is not null
     and (
       exists (select 1 from public.leases l where l.id = p_lease_id and l.user_id = auth.uid())
       or public.has_lease_access(p_lease_id, 'mietverhaeltnisse', 'read')
       or public.has_lease_access(p_lease_id, 'finanzen', 'read')
     )
$$;

create or replace function public.can_write_rent_ledger(p_lease_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and p_lease_id is not null
     and (
       exists (select 1 from public.leases l where l.id = p_lease_id and l.user_id = auth.uid())
       or public.has_lease_access(p_lease_id, 'mietverhaeltnisse', 'write')
       or public.has_lease_access(p_lease_id, 'finanzen', 'write')
     )
$$;

-- Gibt es vor diesem Zeitraum einen früheren Zeitraum desselben Vertrags?
-- (für die Lösch-Policy; ohne RLS, damit die Policy nicht auf sich selbst verweist)
create or replace function public.lease_rent_period_has_earlier(p_lease_id uuid, p_valid_from date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.lease_rent_periods p
    where p.lease_id = p_lease_id
      and p.valid_from < p_valid_from
  )
$$;


-- -----------------------------------------------------------------------------
-- 3. Policies lease_rent_periods
--    Löschen nur für Zeiträume, vor denen es einen früheren gibt: der erste Zeitraum
--    (Anfangsmiete ab Vertragsbeginn) bleibt immer erhalten, sonst würden die Werte eines
--    späteren Zeitraums rückwirkend für die Anfangsmonate gelten. Löschkaskaden über
--    leases laufen ohne RLS und sind davon nicht betroffen.
-- -----------------------------------------------------------------------------
drop policy if exists lease_rent_periods_select on public.lease_rent_periods;
drop policy if exists lease_rent_periods_insert on public.lease_rent_periods;
drop policy if exists lease_rent_periods_update on public.lease_rent_periods;
drop policy if exists lease_rent_periods_delete on public.lease_rent_periods;

create policy lease_rent_periods_select on public.lease_rent_periods
    for select to authenticated
    using (public.can_read_lease_rent(lease_id));

create policy lease_rent_periods_insert on public.lease_rent_periods
    for insert to authenticated
    with check (public.can_write_lease_rent(lease_id));

create policy lease_rent_periods_update on public.lease_rent_periods
    for update to authenticated
    using (public.can_write_lease_rent(lease_id))
    with check (public.can_write_lease_rent(lease_id));

create policy lease_rent_periods_delete on public.lease_rent_periods
    for delete to authenticated
    using (
        public.can_write_lease_rent(lease_id)
        and public.lease_rent_period_has_earlier(lease_id, valid_from)
    );


-- -----------------------------------------------------------------------------
-- 4. Erstbefüllung (nur Verträge ohne Zeitraum; Trigger der Tabelle existieren beim
--    ersten Lauf noch nicht, bei erneutem Lauf werden keine Zeilen eingefügt)
-- -----------------------------------------------------------------------------
insert into public.lease_rent_periods
    (lease_id, valid_from, cold_rent, service_charge, heating_cost, other_costs, payment_due_day, created_by)
select l.id,
       l.start_date,
       greatest(coalesce(l.cold_rent, 0), 0),
       greatest(coalesce(l.service_charge, 0), 0),
       greatest(coalesce(l.heating_cost, 0), 0),
       greatest(coalesce(l.other_costs, 0), 0),
       least(greatest(coalesce(l.payment_due_day, 3), 1), 31),
       null
from public.leases l
where l.start_date is not null
  and not exists (select 1 from public.lease_rent_periods p where p.lease_id = l.id);


-- -----------------------------------------------------------------------------
-- 5. Hilfsfunktionen
-- -----------------------------------------------------------------------------

-- Für einen Monat gültiger Zeitraum (leer, wenn der Vertrag keinen Zeitraum hat).
-- SECURITY INVOKER: direkte Aufrufe unterliegen der RLS; aus den SECURITY-DEFINER-
-- Funktionen heraus läuft sie mit deren Rechten.
create or replace function public.lease_rent_period_for_month(p_lease_id uuid, p_month date)
returns public.lease_rent_periods
language plpgsql
stable
set search_path = public, pg_temp
as $function$
declare
    v_period public.lease_rent_periods;
begin
    select p.* into v_period
    from public.lease_rent_periods p
    where p.lease_id = p_lease_id
      and p.valid_from < (date_trunc('month', p_month) + interval '1 month')::date
    order by p.valid_from desc
    limit 1;

    if v_period.id is null then
        select p.* into v_period
        from public.lease_rent_periods p
        where p.lease_id = p_lease_id
        order by p.valid_from asc
        limit 1;
    end if;

    return v_period;
end;
$function$;

-- Vertragswerte (leases.cold_rent usw.) auf den heute gültigen Zeitraum setzen.
-- Die Vertragswerte sind nur noch die „aktuelle Miete" für Anzeigen; das Mietkonto
-- rechnet ausschließlich mit den Zeiträumen.
create or replace function public.sync_lease_rent_from_periods(p_lease_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    v_period public.lease_rent_periods;
begin
    if p_lease_id is null then
        return;
    end if;

    if pg_trigger_depth() = 0
       and coalesce(auth.role(), '') in ('anon', 'authenticated')
       and not public.can_write_rent_ledger(p_lease_id) then
        raise exception 'Keine Berechtigung für dieses Mietverhältnis.' using errcode = '42501';
    end if;

    v_period := public.lease_rent_period_for_month(p_lease_id, current_date);
    if v_period.id is null then
        return;
    end if;

    -- Kennzeichen: on_lease_change soll diese Angleichung nicht als neue Mietänderung werten
    perform set_config('app.rent_period_sync', 'on', true);

    update public.leases l
       set cold_rent       = v_period.cold_rent,
           service_charge  = v_period.service_charge,
           heating_cost    = v_period.heating_cost,
           other_costs     = v_period.other_costs,
           payment_due_day = v_period.payment_due_day
     where l.id = p_lease_id
       and (l.cold_rent, l.service_charge, l.heating_cost, l.other_costs, l.payment_due_day)
           is distinct from
           (v_period.cold_rent, v_period.service_charge, v_period.heating_cost, v_period.other_costs, v_period.payment_due_day);

    perform set_config('app.rent_period_sync', 'off', true);
end;
$function$;


-- -----------------------------------------------------------------------------
-- 6. Soll-Berechnung (Signaturen unverändert)
-- -----------------------------------------------------------------------------
create or replace function public.recalculate_rent_ledger_entry(p_lease_id uuid, p_period_month date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    v_month date;
    v_lease record;
    v_period public.lease_rent_periods;
    v_row record;
    v_in_range boolean;
    v_expected_rent numeric;
    v_payment_due_day integer;
    v_due_date date;
    v_last_day date;
    v_paid numeric;
begin
    if p_lease_id is null or p_period_month is null then
        return;
    end if;
    v_month := date_trunc('month', p_period_month)::date;

    -- 1. Vertrag
    select id, user_id, start_date, end_date,
           cold_rent, service_charge, heating_cost, other_costs, payment_due_day
      into v_lease
      from public.leases
     where id = p_lease_id;

    if v_lease.id is null or v_lease.user_id is null then
        return;
    end if;

    -- Direkter Aufruf per RPC nur für Berechtigte (Trigger- und Systemaufrufe unverändert)
    if pg_trigger_depth() = 0
       and coalesce(auth.role(), '') in ('anon', 'authenticated')
       and not public.can_write_rent_ledger(p_lease_id) then
        raise exception 'Keine Berechtigung für dieses Mietkonto.' using errcode = '42501';
    end if;

    v_in_range := v_lease.start_date is not null
                  and v_month >= date_trunc('month', v_lease.start_date)::date
                  and (v_lease.end_date is null or v_month <= date_trunc('month', v_lease.end_date)::date);

    -- 2. Bezahlte Summe dieses Monats
    select coalesce(sum(amount), 0) into v_paid
      from public.rent_payments
     where lease_id = p_lease_id
       and date_trunc('month', period_month)::date = v_month;

    -- 3. Bestehende Zeile
    select id, status, note into v_row
      from public.rent_ledger
     where lease_id = p_lease_id
       and period_month = v_month;

    -- 4. Monat außerhalb der Vertragslaufzeit: keine neue Sollstellung; unbezahlte,
    --    nicht eingeforderte und nicht manuell bearbeitete Altzeilen entfernen
    if not v_in_range then
        if v_row.id is not null
           and v_paid = 0
           and coalesce(v_row.status, 'open') <> 'loss'
           and coalesce(v_row.note, '') = ''
           and not exists (
               select 1 from public.claim_items ci
                where ci.rent_ledger_id = v_row.id
                   or v_row.id = any(ci.rent_ledger_ids)
           ) then
            delete from public.rent_ledger where id = v_row.id;
            return;
        end if;
        if v_row.id is null and v_paid = 0 then
            return;
        end if;
        -- Zahlungen oder Forderung vorhanden: Zeile wie bisher fortschreiben
    end if;

    -- Manuell als 'loss' markiert und keine Zahlung: Zustand beibehalten
    if v_row.status = 'loss' and v_paid = 0 then
        return;
    end if;

    -- 5. Für den Monat gültige Werte (Miethistorie), sonst Vertragswerte
    v_period := public.lease_rent_period_for_month(p_lease_id, v_month);
    if v_period.id is not null then
        v_expected_rent := coalesce(v_period.cold_rent, 0) + coalesce(v_period.service_charge, 0)
                         + coalesce(v_period.heating_cost, 0) + coalesce(v_period.other_costs, 0);
        v_payment_due_day := coalesce(v_period.payment_due_day, 3);
    else
        v_expected_rent := coalesce(v_lease.cold_rent, 0) + coalesce(v_lease.service_charge, 0)
                         + coalesce(v_lease.heating_cost, 0) + coalesce(v_lease.other_costs, 0);
        v_payment_due_day := coalesce(v_lease.payment_due_day, 3);
    end if;

    -- 6. Fälligkeit: Kalendertag im Monat, höchstens Monatsletzter
    v_payment_due_day := greatest(v_payment_due_day, 1);
    v_last_day := (v_month + interval '1 month' - interval '1 day')::date;
    v_due_date := least(v_month + (v_payment_due_day - 1), v_last_day);

    -- 7. Upsert
    insert into public.rent_ledger (user_id, lease_id, period_month, due_date, expected_rent, paid_amount, status)
    values (
        v_lease.user_id,
        p_lease_id,
        v_month,
        v_due_date,
        v_expected_rent,
        v_paid,
        case when v_paid >= (v_expected_rent - 1) then 'paid' else 'open' end
    )
    on conflict (lease_id, period_month) do update
    set expected_rent = excluded.expected_rent,
        paid_amount   = excluded.paid_amount,
        due_date      = excluded.due_date,
        status        = case when excluded.paid_amount >= (excluded.expected_rent - 1) then 'paid' else 'open' end,
        updated_at    = now();
end;
$function$;


create or replace function public.recalculate_lease_ledgers(p_lease_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    v_lease record;
    v_iter_date date;
    v_start_month date;
    v_end_date date;
    v_row record;
begin
    select id, start_date, end_date, user_id
      into v_lease
      from public.leases
     where id = p_lease_id;

    if v_lease.id is null or v_lease.start_date is null then
        return;
    end if;

    if pg_trigger_depth() = 0
       and coalesce(auth.role(), '') in ('anon', 'authenticated')
       and not public.can_write_rent_ledger(p_lease_id) then
        raise exception 'Keine Berechtigung für dieses Mietkonto.' using errcode = '42501';
    end if;

    v_start_month := date_trunc('month', v_lease.start_date)::date;
    v_iter_date := v_start_month;

    if v_lease.end_date is not null and v_lease.end_date < current_date then
        v_end_date := date_trunc('month', v_lease.end_date)::date;
    else
        v_end_date := date_trunc('month', current_date)::date;
    end if;

    -- Monate der Laufzeit bis heute (bzw. bis Vertragsende)
    while v_iter_date <= v_end_date loop
        perform public.recalculate_rent_ledger_entry(p_lease_id, v_iter_date);
        v_iter_date := (v_iter_date + interval '1 month')::date;
    end loop;

    -- Übrige vorhandene Zeilen (Vorauszahlungen für künftige Monate, Zeilen außerhalb der
    -- Laufzeit nach Verschieben von Beginn/Ende) ebenfalls fortschreiben bzw. bereinigen
    for v_row in
        select rl.period_month
          from public.rent_ledger rl
         where rl.lease_id = p_lease_id
           and (rl.period_month < v_start_month or rl.period_month > v_end_date)
    loop
        perform public.recalculate_rent_ledger_entry(p_lease_id, v_row.period_month);
    end loop;
end;
$function$;


-- Mietkonto aktuell halten (wird beim Laden der Forderungsseite und nach
-- Forderungszahlungen aufgerufen). Fassung = Live-Stand 27.11.2026, ergänzt um
--  - Status 'ended' für Verträge, deren Vertragsende abgelaufen ist (G17-04/G18-06)
--  - Übernahme inzwischen gültiger, geplanter Mietänderungen in die Vertragswerte
create or replace function public.sync_all_rent_ledgers()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    v_user_id uuid;
    v_lease record;
    v_current_month date;
begin
    v_user_id := auth.uid();
    if v_user_id is null then
        return;
    end if;

    v_current_month := date_trunc('month', current_date)::date;

    update public.leases
       set status = 'ended'
     where user_id = v_user_id
       and status = 'active'
       and end_date is not null
       and end_date < current_date;

    -- Nur für Verträge, die im aktuellen Monat aktiv sind
    for v_lease in
        select id
          from public.leases
         where user_id = v_user_id
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


-- Zahlungen: unverändert (nur search_path ergänzt)
create or replace function public.on_rent_payment_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
    if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
        if NEW.lease_id is not null and NEW.period_month is not null then
            perform public.recalculate_rent_ledger_entry(NEW.lease_id, NEW.period_month);
        end if;
        if TG_OP = 'UPDATE' and OLD.lease_id is not null and OLD.period_month is not null
           and (OLD.lease_id != NEW.lease_id or OLD.period_month != NEW.period_month) then
            perform public.recalculate_rent_ledger_entry(OLD.lease_id, OLD.period_month);
        end if;
    elsif TG_OP = 'DELETE' then
        if OLD.lease_id is not null and OLD.period_month is not null then
            perform public.recalculate_rent_ledger_entry(OLD.lease_id, OLD.period_month);
        end if;
    end if;
    return null;
end;
$function$;


-- -----------------------------------------------------------------------------
-- 7. Trigger auf leases: Änderungen nur noch ab Datum
-- -----------------------------------------------------------------------------
create or replace function public.on_lease_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    v_current_month date := date_trunc('month', current_date)::date;
    v_target_month date;
    v_period public.lease_rent_periods;
    v_rent_changed boolean;
begin
    -- Angleichung der Vertragswerte aus sync_lease_rent_from_periods: nichts tun
    if coalesce(current_setting('app.rent_period_sync', true), '') = 'on' then
        return null;
    end if;

    if TG_OP = 'INSERT' then
        if NEW.start_date is not null
           and not exists (select 1 from public.lease_rent_periods where lease_id = NEW.id) then
            -- Anfangsmiete ab Mietbeginn; der Trigger der Miethistorie berechnet das Mietkonto
            insert into public.lease_rent_periods
                (lease_id, valid_from, cold_rent, service_charge, heating_cost, other_costs, payment_due_day)
            values (
                NEW.id,
                NEW.start_date,
                coalesce(NEW.cold_rent, 0),
                coalesce(NEW.service_charge, 0),
                coalesce(NEW.heating_cost, 0),
                coalesce(NEW.other_costs, 0),
                least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)
            );
            return null;
        end if;
        perform public.recalculate_lease_ledgers(NEW.id);
        return null;
    end if;

    -- UPDATE
    v_rent_changed := (NEW.cold_rent, NEW.service_charge, NEW.heating_cost, NEW.other_costs, NEW.payment_due_day)
                      is distinct from
                      (OLD.cold_rent, OLD.service_charge, OLD.heating_cost, OLD.other_costs, OLD.payment_due_day);

    if v_rent_changed then
        -- Direkte Änderung am Vertrag ohne Datum (ältere App-Versionen, andere Masken):
        -- gilt ab dem laufenden Monat, bei noch nicht begonnenen Verträgen ab Mietbeginn.
        v_target_month := greatest(v_current_month, date_trunc('month', NEW.start_date)::date);

        select p.* into v_period
          from public.lease_rent_periods p
         where p.lease_id = NEW.id
           and date_trunc('month', p.valid_from)::date = v_target_month;

        if v_period.id is not null then
            if (v_period.cold_rent, v_period.service_charge, v_period.heating_cost, v_period.other_costs, v_period.payment_due_day)
               is distinct from
               (coalesce(NEW.cold_rent, 0), coalesce(NEW.service_charge, 0), coalesce(NEW.heating_cost, 0),
                coalesce(NEW.other_costs, 0), least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)) then
                update public.lease_rent_periods
                   set cold_rent       = coalesce(NEW.cold_rent, 0),
                       service_charge  = coalesce(NEW.service_charge, 0),
                       heating_cost    = coalesce(NEW.heating_cost, 0),
                       other_costs     = coalesce(NEW.other_costs, 0),
                       payment_due_day = least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)
                 where id = v_period.id;
                -- Neuberechnung übernimmt der Trigger der Miethistorie
                return null;
            end if;
        else
            v_period := public.lease_rent_period_for_month(NEW.id, v_target_month);
            if v_period.id is not null
               and v_target_month < date_trunc('month', v_period.valid_from)::date then
                -- Zielmonat liegt vor dem ersten Zeitraum (Mietbeginn im selben Schritt
                -- vorverlegt): Anfangsmiete anpassen statt einen früheren Zeitraum anzulegen –
                -- sonst gälten ab dem bisherigen Mietbeginn wieder die alten Werte
                if (v_period.cold_rent, v_period.service_charge, v_period.heating_cost, v_period.other_costs, v_period.payment_due_day)
                   is distinct from
                   (coalesce(NEW.cold_rent, 0), coalesce(NEW.service_charge, 0), coalesce(NEW.heating_cost, 0),
                    coalesce(NEW.other_costs, 0), least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)) then
                    update public.lease_rent_periods
                       set cold_rent       = coalesce(NEW.cold_rent, 0),
                           service_charge  = coalesce(NEW.service_charge, 0),
                           heating_cost    = coalesce(NEW.heating_cost, 0),
                           other_costs     = coalesce(NEW.other_costs, 0),
                           payment_due_day = least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)
                     where id = v_period.id;
                    return null;
                end if;
            elsif v_period.id is null
               or (v_period.cold_rent, v_period.service_charge, v_period.heating_cost, v_period.other_costs, v_period.payment_due_day)
                  is distinct from
                  (coalesce(NEW.cold_rent, 0), coalesce(NEW.service_charge, 0), coalesce(NEW.heating_cost, 0),
                   coalesce(NEW.other_costs, 0), least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)) then
                insert into public.lease_rent_periods
                    (lease_id, valid_from, cold_rent, service_charge, heating_cost, other_costs, payment_due_day)
                values (
                    NEW.id,
                    v_target_month,
                    coalesce(NEW.cold_rent, 0),
                    coalesce(NEW.service_charge, 0),
                    coalesce(NEW.heating_cost, 0),
                    coalesce(NEW.other_costs, 0),
                    least(greatest(coalesce(NEW.payment_due_day, 3), 1), 31)
                );
                return null;
            end if;
        end if;
    end if;

    -- Neuberechnung nur bei mietrelevanten Änderungen
    if v_rent_changed
       or (NEW.start_date, NEW.end_date) is distinct from (OLD.start_date, OLD.end_date) then
        perform public.recalculate_lease_ledgers(NEW.id);
    end if;

    return null;
end;
$function$;


-- -----------------------------------------------------------------------------
-- 8. Trigger auf lease_rent_periods
-- -----------------------------------------------------------------------------
create or replace function public.lease_rent_periods_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
    if TG_OP = 'INSERT' then
        if auth.uid() is not null then
            NEW.created_by := auth.uid();
        end if;
        NEW.created_at := now();
    else
        if NEW.lease_id is distinct from OLD.lease_id then
            raise exception 'Ein Mietzeitraum kann keinem anderen Mietvertrag zugeordnet werden.';
        end if;
        -- Ersteller nicht umschreibbar; ON DELETE SET NULL des Fremdschlüssels bleibt möglich
        if NEW.created_by is not null then
            NEW.created_by := OLD.created_by;
        end if;
        NEW.created_at := OLD.created_at;
    end if;

    NEW.cold_rent := coalesce(NEW.cold_rent, 0);
    NEW.service_charge := coalesce(NEW.service_charge, 0);
    NEW.heating_cost := coalesce(NEW.heating_cost, 0);
    NEW.other_costs := coalesce(NEW.other_costs, 0);
    NEW.payment_due_day := coalesce(NEW.payment_due_day, 3);
    return NEW;
end;
$function$;

create or replace function public.on_lease_rent_period_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    v_lease_id uuid;
begin
    if TG_OP = 'DELETE' then
        v_lease_id := OLD.lease_id;
    else
        v_lease_id := NEW.lease_id;
    end if;

    -- Löschkaskade des Vertrags: nichts neu berechnen
    if not exists (select 1 from public.leases where id = v_lease_id) then
        return null;
    end if;

    perform public.recalculate_lease_ledgers(v_lease_id);
    perform public.sync_lease_rent_from_periods(v_lease_id);
    return null;
end;
$function$;

drop trigger if exists trigger_lease_rent_periods_before_write on public.lease_rent_periods;
create trigger trigger_lease_rent_periods_before_write
    before insert or update on public.lease_rent_periods
    for each row execute function public.lease_rent_periods_before_write();

drop trigger if exists trigger_on_lease_rent_period_change on public.lease_rent_periods;
create trigger trigger_on_lease_rent_period_change
    after insert or update or delete on public.lease_rent_periods
    for each row execute function public.on_lease_rent_period_change();

-- trigger_on_lease_change (leases) und trigger_on_rent_payment_change (rent_payments)
-- bestehen bereits und rufen die oben ersetzten Funktionen auf. Zur Sicherheit neu anlegen:
drop trigger if exists trigger_on_lease_change on public.leases;
create trigger trigger_on_lease_change
    after insert or update on public.leases
    for each row execute function public.on_lease_change();


-- -----------------------------------------------------------------------------
-- 9. Policies rent_ledger / rent_charges (D3b-12)
--    Lesen: eigene Zeilen wie bisher, zusätzlich Eigentümer und Mitnutzer
--    („mietverhaeltnisse" oder „finanzen") über den Mietvertrag.
--    Schreiben: nur mit Schreibrecht auf den Mietvertrag (nicht mehr nur über user_id).
-- -----------------------------------------------------------------------------
alter table public.rent_ledger enable row level security;

drop policy if exists rent_ledger_owner_all on public.rent_ledger;
drop policy if exists shared_users_select on public.rent_ledger;
drop policy if exists shared_users_insert on public.rent_ledger;
drop policy if exists shared_users_update on public.rent_ledger;
drop policy if exists shared_users_delete on public.rent_ledger;
drop policy if exists rent_ledger_select on public.rent_ledger;
drop policy if exists rent_ledger_insert on public.rent_ledger;
drop policy if exists rent_ledger_update on public.rent_ledger;
drop policy if exists rent_ledger_delete on public.rent_ledger;

create policy rent_ledger_select on public.rent_ledger
    for select to authenticated
    using (user_id = auth.uid() or public.can_read_rent_ledger(lease_id));

create policy rent_ledger_insert on public.rent_ledger
    for insert to authenticated
    with check (public.can_write_rent_ledger(lease_id));

create policy rent_ledger_update on public.rent_ledger
    for update to authenticated
    using (public.can_write_rent_ledger(lease_id))
    with check (public.can_write_rent_ledger(lease_id));

create policy rent_ledger_delete on public.rent_ledger
    for delete to authenticated
    using (public.can_write_rent_ledger(lease_id));

alter table public.rent_charges enable row level security;

drop policy if exists rent_charges_own_all on public.rent_charges;
drop policy if exists shared_users_select on public.rent_charges;
drop policy if exists shared_users_insert on public.rent_charges;
drop policy if exists shared_users_update on public.rent_charges;
drop policy if exists shared_users_delete on public.rent_charges;
drop policy if exists rent_charges_select on public.rent_charges;
drop policy if exists rent_charges_insert on public.rent_charges;
drop policy if exists rent_charges_update on public.rent_charges;
drop policy if exists rent_charges_delete on public.rent_charges;

create policy rent_charges_select on public.rent_charges
    for select to authenticated
    using (user_id = auth.uid() or public.can_read_rent_ledger(lease_id));

create policy rent_charges_insert on public.rent_charges
    for insert to authenticated
    with check (public.can_write_rent_ledger(lease_id));

create policy rent_charges_update on public.rent_charges
    for update to authenticated
    using (public.can_write_rent_ledger(lease_id))
    with check (public.can_write_rent_ledger(lease_id));

create policy rent_charges_delete on public.rent_charges
    for delete to authenticated
    using (public.can_write_rent_ledger(lease_id));
