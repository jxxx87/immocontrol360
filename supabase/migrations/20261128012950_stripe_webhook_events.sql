-- =============================================================================
-- Wave 3 · Paket 10 STRIPE (27.11.2026)
--
-- Befund:
--   E3-09  Ereignisprotokoll für den Stripe-Webhook: jedes verarbeitete Stripe-Ereignis wird mit
--          seiner event.id vermerkt (Status, Versuche, Ergebnis-Code, kurze Fehlermeldung).
--          - stripe_webhook_event_begin: legt das Ereignis an bzw. entscheidet, ob es verarbeitet
--            wird ('process'), schon verarbeitet ist ('duplicate') oder gerade in einer anderen
--            Zustellung läuft ('in_progress', jünger als 10 Minuten). Fehlgeschlagene oder hängen
--            gebliebene Ereignisse werden erneut verarbeitet (attempts + 1).
--          - stripe_webhook_event_finish: Ergebnis vermerken ('processed' / 'failed').
--          Nicht verbuchbare Forderungszahlungen erscheinen mit outcome = 'claim_payment_unbooked'
--          (bzw. 'claim_payment_unbooked_no_claim') und als Hinweis in der Forderungsakte.
--
-- Nur für die Server-Rolle (Edge Function stripe-webhook mit Service-Schlüssel):
--   RLS an und KEINE Policies → angemeldete Nutzer und anon sehen nichts; Tabellen- und
--   Funktionsrechte nur für service_role. Die Funktionen sind SECURITY INVOKER.
--   Gespeichert werden keine Personendaten und kein Ereignisinhalt (nur IDs, Typ, Status).
--
-- VERTRÄGLICH MIT DER HEUTE AUSGELIEFERTEN APP UND EDGE FUNCTION: neue Objekte, die App nutzt sie
--   nicht; die heute live laufende stripe-webhook-Fassung ruft sie nicht auf. Die neue Fassung
--   arbeitet auch ohne diese Migration (Protokoll dann „nicht verfügbar“, Verarbeitung wie bisher).
--
-- Unabhängig von 01_CLAIMS-DB / 07_claims-portal (ändert keine bestehenden Objekte).
-- Idempotent: mehrfaches Ausführen ist unschädlich.
-- =============================================================================

create table if not exists public.stripe_webhook_events (
  event_id          text primary key,
  event_type        text not null,
  livemode          boolean,
  connect_account   text,
  stripe_created_at timestamptz,
  status            text not null default 'processing',
  attempts          integer not null default 1,
  outcome           text,
  last_error        text,
  received_at       timestamptz not null default now(),
  started_at        timestamptz not null default now(),
  processed_at      timestamptz,
  constraint stripe_webhook_events_event_id_check check (event_id ~ '^evt_[A-Za-z0-9]{1,255}$'),
  constraint stripe_webhook_events_event_type_check check (char_length(event_type) between 1 and 100),
  constraint stripe_webhook_events_account_check check (connect_account is null or connect_account ~ '^acct_[A-Za-z0-9]{1,255}$'),
  constraint stripe_webhook_events_status_check check (status in ('processing', 'processed', 'failed')),
  constraint stripe_webhook_events_attempts_check check (attempts >= 1),
  constraint stripe_webhook_events_outcome_check check (outcome is null or outcome ~ '^[a-z_]{1,100}$'),
  constraint stripe_webhook_events_error_check check (last_error is null or char_length(last_error) <= 500)
);

comment on table public.stripe_webhook_events is
  'Ereignisprotokoll des Stripe-Webhooks (Edge Function stripe-webhook, nur service_role): je Stripe-Ereignis (event.id) Status, Versuche, Ergebnis-Code und kurze Fehlermeldung. Kein Ereignisinhalt, keine Personendaten.';
comment on column public.stripe_webhook_events.outcome is
  'Ergebnis-Code der Verarbeitung, z. B. claim_payment_booked, claim_payment_duplicate, claim_payment_unbooked (fachlich nicht verbuchbar, Hinweis in der Forderungsakte), claim_payment_unbooked_no_claim, unhandled.';
comment on column public.stripe_webhook_events.started_at is
  'Beginn des letzten Verarbeitungsversuchs; ein Versuch im Status processing gilt nach 10 Minuten als abgebrochen.';

create index if not exists stripe_webhook_events_status_received_idx
  on public.stripe_webhook_events (status, received_at desc);

alter table public.stripe_webhook_events enable row level security;

revoke all on table public.stripe_webhook_events from public, anon, authenticated;
grant select, insert, update, delete on table public.stripe_webhook_events to service_role;

-- -----------------------------------------------------------------------------
-- Beginn der Verarbeitung eines Ereignisses
-- -----------------------------------------------------------------------------
create or replace function public.stripe_webhook_event_begin(
  p_event_id text,
  p_event_type text,
  p_livemode boolean default null,
  p_account text default null,
  p_created bigint default null)
returns text
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_status text;
  v_started timestamptz;
begin
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9]{1,255}$' then
    raise exception 'Ungültige Stripe-Ereignis-ID.' using errcode = '22023';
  end if;

  insert into public.stripe_webhook_events (event_id, event_type, livemode, connect_account, stripe_created_at)
  values (
    p_event_id,
    left(coalesce(nullif(btrim(p_event_type), ''), 'unknown'), 100),
    p_livemode,
    case when p_account ~ '^acct_[A-Za-z0-9]{1,255}$' then p_account end,
    case when p_created > 0 and p_created < 32503680000 then to_timestamp(p_created) end)
  on conflict (event_id) do nothing;
  if found then
    return 'process';
  end if;

  -- Ereignis ist bekannt: Zeile sperren, damit nur EINE Zustellung es übernimmt
  select e.status, e.started_at into v_status, v_started
    from public.stripe_webhook_events e
   where e.event_id = p_event_id
   for update;

  if v_status = 'processed' then
    return 'duplicate';
  end if;
  if v_status = 'processing' and v_started > clock_timestamp() - interval '10 minutes' then
    return 'in_progress';
  end if;

  -- fehlgeschlagen oder abgebrochen → erneut verarbeiten
  update public.stripe_webhook_events
     set status = 'processing',
         attempts = attempts + 1,
         started_at = clock_timestamp()
   where event_id = p_event_id;
  return 'process';
end;
$function$;

comment on function public.stripe_webhook_event_begin(text, text, boolean, text, bigint) is
  'Stripe-Webhook (nur service_role): Ereignis vermerken. Rückgabe process | duplicate | in_progress.';

-- -----------------------------------------------------------------------------
-- Ergebnis der Verarbeitung
-- -----------------------------------------------------------------------------
create or replace function public.stripe_webhook_event_finish(
  p_event_id text,
  p_success boolean,
  p_outcome text default null,
  p_error text default null)
returns void
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $function$
begin
  update public.stripe_webhook_events
     set status = case when coalesce(p_success, false) then 'processed' else 'failed' end,
         processed_at = case when coalesce(p_success, false) then clock_timestamp() end,
         outcome = case when p_outcome ~ '^[a-z_]{1,100}$' then p_outcome end,
         last_error = case
                        when coalesce(p_success, false) then null
                        else left(coalesce(nullif(btrim(p_error), ''), 'Unbekannter Fehler'), 500)
                      end
   where event_id = p_event_id;
end;
$function$;

comment on function public.stripe_webhook_event_finish(text, boolean, text, text) is
  'Stripe-Webhook (nur service_role): Ergebnis eines Ereignisses vermerken (processed/failed).';

revoke execute on function public.stripe_webhook_event_begin(text, text, boolean, text, bigint) from public, anon, authenticated;
revoke execute on function public.stripe_webhook_event_finish(text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.stripe_webhook_event_begin(text, text, boolean, text, bigint) to service_role;
grant execute on function public.stripe_webhook_event_finish(text, boolean, text, text) to service_role;

notify pgrst, 'reload schema';
