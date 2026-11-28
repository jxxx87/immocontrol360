-- =============================================================================
-- Welle 7 – Paket forderungen-1 · Befund A-1 (hoch)
-- Mahnschreiben und Forderungsportal nennen dieselbe Bankverbindung
--
-- Befund: Das Mahn-PDF (immo-web/src/lib/claimPdfGenerator.js, Abschnitt "5. Bankverbindung")
--   nimmt die Bankverbindung des PORTFOLIOS, wenn portfolios.iban gefüllt ist, sonst die des
--   Profils des Forderungs-Eigentümers. Das Forderungsportal (get_public_claim_by_token), das der
--   Schuldner über den QR-Code aus demselben Schreiben öffnet, las Empfänger/IBAN/BIC (und damit
--   den GiroCode) dagegen nur aus profiles des Eigentümers. Bei abweichender Portfolio-IBAN
--   stand im Brief ein anderes Konto als im Portal bzw. im GiroCode.
--
-- Korrektur (Live-Stand bis 20261128092217):
--   1) Neue interne Hilfsfunktion claim_portal_bank_details(p_claim_id) mit GENAU der Regel des PDFs:
--        Portfolio-IBAN gefüllt  -> IBAN/BIC/Bank aus dem Portfolio,
--                                   Inhaber = Firmenname des Portfolios, sonst Absendername
--        sonst Profil-IBAN gefüllt -> IBAN/BIC/Bank aus dem Profil,
--                                   Inhaber = Kontoinhaber des Profils, sonst Absendername
--        sonst                     -> keine Bankverbindung (Portal blendet die Überweisung aus;
--                                   das PDF schreibt "das Ihnen bekannte Bankkonto")
--      Absendername = Firma (Profil), sonst Vor- und Nachname (Profil), sonst Firmenname (Portfolio).
--      Portfolio = claims.lease_id -> leases.unit_id -> units.property_id -> properties.portfolio_id.
--      Rückgabe-Schlüssel wie bisher (account_holder, iban, bic; leere Zeichenkette statt null),
--      zusätzlich bank_name und source ('portfolio' | 'profile' | 'none').
--      SECURITY INVOKER, nur intern: kein EXECUTE für PUBLIC/anon/authenticated (Aufruf nur aus der
--      SECURITY-DEFINER-Funktion get_public_claim_by_token, die als Eigentümer postgres läuft).
--   2) get_public_claim_by_token(text, text): Text 1:1 aus dem Live-Stand (pg_get_functiondef),
--      nur der Block 'bank_details' ruft jetzt die Hilfsfunktion. Signatur, SECURITY DEFINER,
--      search_path und Rechte (Token-RPC: anon, authenticated, service_role) unverändert.
--
-- ACHTUNG Zusammenführung: Paket forderungen-2 (Befund A-3) ersetzt get_public_claim_by_token
--   ebenfalls (zusätzliche Felder due_date/period_month in 'items'). Wer als ZWEITES eingespielt
--   wird, muss beide Änderungen enthalten. Für diese Datei genügt beim Zusammenführen:
--   im 'bank_details'-Block  public.claim_portal_bank_details(v_claim.id)  verwenden.
--
-- App: ClaimPortal.jsx braucht keine Änderung (liest bank_details.account_holder/iban/bic wie bisher).
-- Idempotent (create or replace). Rollback: rollback/forderungen-1_01_claim_portal_bank_source.rollback.sql
-- =============================================================================

create or replace function public.claim_portal_bank_details(p_claim_id uuid)
 returns json
 language sql
 stable
 set search_path = public, pg_temp
as $function$
  -- Gleiche Regel wie claimPdfGenerator.js (generateClaimPdf, "5. Bankverbindung"): Portfolio vor Profil
  with src as (
    select pf.company_name as pf_company,
           pf.bank_name    as pf_bank_name,
           pf.iban         as pf_iban,
           pf.bic          as pf_bic,
           p.company       as p_company,
           p.first_name    as p_first_name,
           p.last_name     as p_last_name,
           p.bank_account_holder as p_holder,
           p.bank_name     as p_bank_name,
           p.iban          as p_iban,
           p.bic           as p_bic
      from public.claims c
      left join public.leases l      on l.id = c.lease_id
      left join public.units u       on u.id = l.unit_id
      left join public.properties pr on pr.id = u.property_id
      left join public.portfolios pf on pf.id = pr.portfolio_id
      left join public.profiles p    on p.id = c.user_id
     where c.id = p_claim_id
  ), x as (
    select s.*,
           coalesce(nullif(btrim(s.p_company), ''),
                    nullif(concat_ws(' ', nullif(btrim(s.p_first_name), ''), nullif(btrim(s.p_last_name), '')), ''),
                    nullif(btrim(s.pf_company), '')) as sender_name,
           case when nullif(btrim(s.pf_iban), '') is not null then 'portfolio'
                when nullif(btrim(s.p_iban), '') is not null then 'profile'
                else 'none' end as source
      from src s
  )
  select json_build_object(
           'account_holder', case x.source
                               when 'portfolio' then coalesce(nullif(btrim(x.pf_company), ''), x.sender_name, '')
                               when 'profile'   then coalesce(nullif(btrim(x.p_holder), ''), x.sender_name, '')
                               else '' end,
           'iban',      case x.source when 'portfolio' then coalesce(x.pf_iban, '') when 'profile' then coalesce(x.p_iban, '') else '' end,
           'bic',       case x.source when 'portfolio' then coalesce(x.pf_bic, '') when 'profile' then coalesce(x.p_bic, '') else '' end,
           'bank_name', case x.source when 'portfolio' then coalesce(x.pf_bank_name, '') when 'profile' then coalesce(x.p_bank_name, '') else '' end,
           'source',    x.source)
    from x
$function$;

comment on function public.claim_portal_bank_details(uuid) is
  'Bankverbindung einer Forderung für Forderungsportal/GiroCode: Portfolio vor Profil (gleiche Regel wie das Mahn-PDF). Nur intern (get_public_claim_by_token).';

revoke execute on function public.claim_portal_bank_details(uuid) from public, anon, authenticated;
grant execute on function public.claim_portal_bank_details(uuid) to service_role;


CREATE OR REPLACE FUNCTION public.get_public_claim_by_token(p_token text, p_pin text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      return json_build_object(
        'error', v_access ->> 'error',
        'code', v_access ->> 'code',
        'attempts_left', v_access -> 'attempts_left');
    end if;
    raise exception using message = v_access ->> 'error', hint = v_access ->> 'code';
  end if;

  select * into v_claim from public.claims c where c.id = (v_access ->> 'claim_id')::uuid;

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
      -- A-1 (Welle 7): gleiche Bankverbindung wie im Mahnschreiben (Portfolio vor Profil)
      'bank_details', public.claim_portal_bank_details(v_claim.id)
  ) into v_result;

  return v_result;
end;
$function$;

-- Rechte der Token-RPC wie im Live-Stand
revoke execute on function public.get_public_claim_by_token(text, text) from public;
grant execute on function public.get_public_claim_by_token(text, text) to anon, authenticated, service_role;
