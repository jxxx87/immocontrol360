-- ════════════════════════════════════════════════════════════════════════════
-- 100500_sec_subscriptions.sql  ·  Paket BILLING  ·  Komplett-Check 2026-11-27
--
-- Befunde:
--   D3b-04, E3-05, G01-04, G03-01, M1-04  Nutzer konnten ihre eigene Abo-Zeile
--       (plan/status/trial_ends_at) per RLS frei schreiben → Paywall-Umgehung.
--       Fix: INSERT/UPDATE-Policies entfernt, Tabellenrechte für anon/authenticated
--       auf SELECT (nur authenticated) reduziert. Lesen der EIGENEN Zeile bleibt.
--       Geschrieben wird ausschließlich von Edge Functions mit Service-Role
--       (stripe-webhook, register-trial). Die App selbst schreibt die Tabelle nirgends
--       (geprüft: immo-web/src, immowebsite/src – nur SELECT in SubscriptionContext.jsx).
--   E3-01 / E3-04 (Missbrauchsbremse register-trial): neue RPC register_trial_rate_check
--       (nur für service_role nutzbar, prüft selbst die JWT-Rolle).
--   G03-13: neue Spalte cancel_at_period_end (vom Webhook gepflegt, in Billing.jsx angezeigt;
--       Webhook und App funktionieren auch ohne die Spalte).
--
-- Bewusst NICHT enthalten:
--   - CHECK-Constraints auf plan/status: der derzeit deployte (alte) Webhook schreibt
--     Stripe-Status und Produkt-Metadaten ungefiltert; ein Constraint könnte dort Webhook-
--     Fehler (500 → Stripe-Retries) und damit fehlende Freischaltungen auslösen.
--     Die neuen Functions validieren plan/status selbst.
--   - Abo-Limits (Einheitenzahl/Funktionen) per Trigger/RLS: nicht eindeutig und nicht
--     risikolos (Mieter/Mitbenutzer schreiben teils in fremde Portfolios, 3 von 6 Konten
--     haben gar keine Abo-Zeile, bestehende Kunden könnten blockiert werden).
--
-- Idempotent: kann mehrfach ausgeführt werden.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Policies: nur noch Lesen der eigenen Zeile ─────────────────────────────
alter table public.subscriptions enable row level security;

drop policy if exists "Users can insert own subscription" on public.subscriptions;
drop policy if exists "Users can update own subscription" on public.subscriptions;
drop policy if exists "Users can view own subscription"   on public.subscriptions;
drop policy if exists subscriptions_select_own             on public.subscriptions;

create policy subscriptions_select_own
    on public.subscriptions
    for select
    to authenticated
    using (user_id = (select auth.uid()));

-- ── 2. Tabellenrechte: Clients dürfen nur lesen ───────────────────────────────
-- (TRUNCATE/MAINTAIN unterliegen nicht der RLS → auch diese entziehen)
revoke all on table public.subscriptions from anon, authenticated;
grant select on table public.subscriptions to authenticated;
grant all on table public.subscriptions to service_role;

-- ── 3. Neue Spalte: Kündigung zum Laufzeitende (G03-13) ───────────────────────
alter table public.subscriptions
    add column if not exists cancel_at_period_end boolean not null default false;

comment on column public.subscriptions.cancel_at_period_end is
    'Stripe: Abo ist zum Ende der laufenden Periode gekündigt (gepflegt von stripe-webhook).';

-- ── 4. Missbrauchsbremse für register-trial ───────────────────────────────────
-- Liefert 'ok' | 'global_limit' | 'domain_limit' | 'invalid'.
-- Zählt neue Testphasen (Abo-Zeilen ohne Stripe-Kunde) der letzten Stunde – gesamt
-- und je E-Mail-Domain. Nur mit service_role-JWT aufrufbar (Edge Function).
create or replace function public.register_trial_rate_check(p_email text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_claims       jsonb;
    v_email        text := lower(btrim(coalesce(p_email, '')));
    v_domain       text;
    v_global       integer;
    v_domain_count integer;
begin
    begin
        v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    exception when others then
        v_claims := null;
    end;

    if coalesce(v_claims ->> 'role', '') <> 'service_role' then
        raise exception 'register_trial_rate_check: nur für Server-Funktionen'
            using errcode = '42501';
    end if;

    v_domain := split_part(v_email, '@', 2);
    if position('@' in v_email) = 0 or v_domain = '' then
        return 'invalid';
    end if;

    select count(*) into v_global
      from public.subscriptions s
     where s.created_at > now() - interval '1 hour'
       and s.stripe_customer_id is null;

    if v_global >= 30 then
        return 'global_limit';
    end if;

    select count(*) into v_domain_count
      from public.subscriptions s
      join auth.users u on u.id = s.user_id
     where s.created_at > now() - interval '1 hour'
       and s.stripe_customer_id is null
       and lower(split_part(u.email, '@', 2)) = v_domain;

    if v_domain_count >= 10 then
        return 'domain_limit';
    end if;

    return 'ok';
end;
$$;

comment on function public.register_trial_rate_check(text) is
    'Missbrauchsbremse für die Edge Function register-trial (nur service_role). Paket BILLING, 2026-11-27.';
