-- =============================================================================
-- Wave 3 – Paket 08 CLOUD, Abschluss M2-06: OAuth-Tokens NUR noch im Vault
--
-- ERST EINSPIELEN, WENN
--   1. _fixwork/sql/wave3/08_cloud.sql eingespielt ist und
--   2. ALLE VIER Edge Functions in der neuen Fassung deployt sind:
--      cloud-auth, cloud-drive, cloud-sync, sync-applicant-files
--      (sie lesen/schreiben Tokens über cloud_get_tokens/cloud_store_tokens).
--   Eine noch alte Function-Version würde danach leere Token-Spalten lesen
--   (Folge: "bitte neu verbinden" bzw. Bewerberunterlagen bleiben im Speicher).
--
-- Wirkung:
--   - cloud_tokens_keep_plaintext() = false -> cloud_store_tokens schreibt nur noch den Vault
--   - alle vorhandenen Klartext-Tokens werden in den Vault übernommen, die Spalten
--     access_token/refresh_token werden geleert (NULL).
--   Die Spalten selbst bleiben vorerst bestehen (Rückfallweg der Functions, falls 08 zurückgebaut wird);
--   endgültig entfernen in einer späteren Bereinigung.
--
-- Idempotent: mehrfaches Ausführen ist unschädlich.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.cloud_store_tokens(uuid,uuid,text,text,timestamptz)') is null
     or to_regprocedure('public.cloud_get_tokens(uuid,uuid)') is null then
    raise exception '08_cloud.sql ist nicht eingespielt – 08b_cloud_tokens_finalize abgebrochen';
  end if;
end $$;

create or replace function public.cloud_tokens_keep_plaintext()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$ select false $$;

revoke execute on function public.cloud_tokens_keep_plaintext() from public, anon, authenticated, service_role;

-- Vorhandene Klartext-Tokens in den Vault übernehmen (cloud_store_tokens leert danach die Spalten)
do $$
declare
  r record;
begin
  for r in
    select c.id, c.user_id
      from public.cloud_connections c
     where c.access_token is not null or c.refresh_token is not null
  loop
    perform public.cloud_store_tokens(r.id, r.user_id, null, null, null);
  end loop;

  if exists (select 1 from public.cloud_connections where access_token is not null or refresh_token is not null) then
    raise exception 'Es liegen noch Klartext-Tokens in cloud_connections – Abbruch';
  end if;
end $$;
