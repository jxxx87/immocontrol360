-- =============================================================================
-- Welle 7 – Paket forderungen-1 · Befunde A-6 (niedrig) und B-48 (niedrig)
-- Forderung stornieren / Forderungsausfall buchen in EINER Transaktion
--
-- Befund: Claims.jsx (handleConfirmCancel) und TenantDetail.jsx (handleWriteOffClaim) stornieren
--   eine Forderung über mehrere getrennte PostgREST-Aufrufe (offene Raten -> Ratenplan -> Portal-Link
--   -> claims -> claim_events). Bricht die Verbindung zwischen zwei Aufrufen ab, bleibt ein halber
--   Zustand (z. B. Ratenplan beendet, Forderung aktiv; Forderung storniert, Portal-Link aktiv;
--   Storno fehlt dauerhaft in der Historie). Eine Storno-RPC gab es live nicht.
--
-- Korrektur (Live-Stand bis 20261128092217): neue RPC
--   cancel_claim(p_claim_id uuid, p_reason text, p_write_off boolean default false) returns json
--   SECURITY DEFINER, search_path fest, Rechteprüfung wie reverse_payment_plan
--   (Eigentümer der Forderung oder has_claim_access(…, 'finanzen', 'write')).
--   Ablauf (alles eine Transaktion, Forderung per FOR UPDATE gesperrt):
--     - Grund Pflicht; bereits stornierte/archivierte Forderung -> Fehler
--     - p_write_off = false (Storno, Claims.jsx): aktive Ratenpläne beenden (offene/teilbezahlte/
--       überfällige Raten -> 'cancelled', Plan -> 'cancelled' mit Grund), bezahlte Raten bleiben
--     - p_write_off = true (Forderungsausfall, TenantDetail.jsx): läuft ein Ratenplan -> Fehler wie
--       bisher in der App ("zuerst in der Forderungsakte beenden"); Grund mit Präfix
--       "Forderungsausfall: " wie bisher
--     - aktive Portal-Links sperren (is_active = false, revoked_at)
--     - claims: status 'cancelled', cancelled_at/_by, cancellation_reason
--     - claim_events: wie bisher die App ('cancelled' / 'Forderung storniert' bzw.
--       'status_changed' / 'Forderungsausfall gebucht'), user_id = Eigentümer der Forderung
--   Ratenplan-Änderungen sind reine Stornierungen, die der Schutz-Trigger
--   protect_claim_payment_records ausdrücklich zulässt (kein app.claims_rpc_bypass nötig).
--   Gebuchte Zahlungen bleiben unverändert.
--   Rechte: revoke execute from public, anon; grant execute to authenticated, service_role.
--
-- App: Claims.jsx und TenantDetail.jsx rufen über cancelClaim() (src/lib/claimPdfGenerator.js) zuerst
--   diese RPC auf und fallen nur bei fehlender Funktion (PGRST202/42883/404) auf den bisherigen
--   Ablauf zurück – funktioniert also vor und nach dem Einspielen.
-- Idempotent (create or replace). Rollback: rollback/forderungen-1_02_cancel_claim.rollback.sql
-- =============================================================================

create or replace function public.cancel_claim(p_claim_id uuid, p_reason text, p_write_off boolean default false)
 returns json
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_caller uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_write_off boolean := coalesce(p_write_off, false);
  v_now timestamptz := now();
  v_plan_ids uuid[];
  v_links integer := 0;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  if v_reason is null then
    raise exception 'Bitte geben Sie einen Grund an.';
  end if;

  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found
     or (v_claim.user_id <> v_caller and not public.has_claim_access(p_claim_id, 'finanzen', 'write')) then
    raise exception 'Forderung nicht gefunden oder keine Berechtigung.';
  end if;

  if v_claim.status in ('cancelled', 'archived') then
    raise exception 'Diese Forderung ist bereits storniert bzw. archiviert.';
  end if;

  select coalesce(array_agg(pp.id order by pp.created_at), '{}'::uuid[]) into v_plan_ids
    from public.payment_plans pp
   where pp.claim_id = p_claim_id and pp.status = 'active';

  if v_write_off and cardinality(v_plan_ids) > 0 then
    raise exception 'Für diese Forderung läuft ein Ratenplan. Bitte beenden Sie den Ratenplan zuerst in der Forderungsakte (Details), bevor Sie einen Forderungsausfall buchen.';
  end if;

  if cardinality(v_plan_ids) > 0 then
    -- reine Stornierung (vom Schutz-Trigger zugelassen): nur Status/Zeitstempel/Grund
    update public.payment_plan_installments
       set status = 'cancelled', updated_at = v_now
     where payment_plan_id = any(v_plan_ids)
       and status in ('open', 'partial', 'overdue');
    update public.payment_plans
       set status = 'cancelled', cancelled_at = v_now, cancelled_by = v_caller,
           cancellation_reason = v_reason, updated_at = v_now
     where id = any(v_plan_ids);
  end if;

  update public.claim_access_links
     set is_active = false, revoked_at = coalesce(revoked_at, v_now)
   where claim_id = p_claim_id and is_active = true;
  get diagnostics v_links = row_count;

  update public.claims
     set status = 'cancelled',
         cancelled_at = v_now,
         cancelled_by = v_caller,
         cancellation_reason = case when v_write_off then 'Forderungsausfall: ' || v_reason else v_reason end,
         updated_at = v_now
   where id = p_claim_id;

  insert into public.claim_events (user_id, claim_id, event_type, description, event_metadata)
  values (v_claim.user_id, p_claim_id,
          case when v_write_off then 'status_changed' else 'cancelled' end,
          case when v_write_off then 'Forderungsausfall gebucht' else 'Forderung storniert' end,
          jsonb_build_object(
              'old_status', v_claim.status,
              'new_status', 'cancelled',
              'reason', v_reason,
              'write_off', v_write_off,
              'cancelled_payment_plan_ids', to_jsonb(v_plan_ids),
              'revoked_portal_links', v_links,
              'source', 'cancel_claim'));

  return json_build_object(
      'claim_id', p_claim_id,
      'old_status', v_claim.status,
      'cancelled_payment_plan_ids', to_jsonb(v_plan_ids),
      'revoked_portal_links', v_links);
end;
$function$;

comment on function public.cancel_claim(uuid, text, boolean) is
  'Forderung stornieren (p_write_off=false) bzw. Forderungsausfall buchen (true) in einer Transaktion: Ratenplan, Portal-Links, Status, Historie.';

revoke execute on function public.cancel_claim(uuid, text, boolean) from public, anon;
grant execute on function public.cancel_claim(uuid, text, boolean) to authenticated, service_role;
