-- =============================================================================
-- Welle 4 · Paket G_DB · 02 Änderungsprotokoll für Selbständerungen im Mieterportal
-- Befund: Folgearbeit aus Welle 3 / 09_TENANT-MGMT (G17b-07, G19-10): Ändert der Mieter seine
--         Kontaktdaten selbst im Portal (TenantStamdaten.jsx, Policy tenants_update_own_tenant),
--         entsteht kein Eintrag in tenant_change_log – nur der Mieterdaten-Link protokolliert.
--
-- Live geprüft am 28.11.2026:
--   - Trigger auf tenants: trg_tenants_protect_columns (BEFORE UPDATE; lässt dem Mieter nur Vor-/Nachname,
--     Telefon und Anschrift, E-Mail nicht; beim Token-Link immo.tenant_update_source = 'token_link'),
--     trg_sync_tenant_to_contact (AFTER INSERT OR UPDATE, pg_trigger_depth-Schutz). Beide unverändert.
--   - tenant_change_log: source text not null default 'token_link', KEIN CHECK auf source;
--     authenticated nur SELECT (Policy has_tenant_access … 'mietverhaeltnisse' 'read'), kein INSERT →
--     die Trigger-Funktion muss SECURITY DEFINER sein. Tabelle gehört postgres, RLS nicht erzwungen.
--   - update_tenant_by_token schreibt seine Zeile selbst (source 'token_link') und setzt während seines
--     UPDATE immo.tenant_update_source = 'token_link' → dieser Trigger protokolliert dann nicht doppelt.
--
-- Protokolliert wird NUR, wenn der angemeldete Aufrufer Mieter dieses Datensatzes ist
-- (user_roles: role 'tenant', tenant_id = Datensatz), selbst keine Vermieter-/Team-Rechte darauf hat
-- (Eigentümer oder has_tenant_access … 'write', wie trg_tenants_protect_columns) und sich eines der Felder von
-- update_tenant_by_token geändert hat (first_name, last_name, street, house_number, postal_code,
-- city, phone, email). Vermieter-/Team-Änderungen, Server-Rolle und Token-Link: kein Eintrag.
-- Idempotent. notify_push wird nicht berührt.
-- =============================================================================

create or replace function public.tenants_log_portal_change()
 returns trigger
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
begin
  -- Der Mieterdaten-Link protokolliert selbst (update_tenant_by_token)
  if v_uid is null
     or coalesce(current_setting('immo.tenant_update_source', true), '') = 'token_link' then
    return null;
  end if;

  if (old.first_name, old.last_name, old.street, old.house_number, old.postal_code, old.city, old.phone, old.email)
     is not distinct from
     (new.first_name, new.last_name, new.street, new.house_number, new.postal_code, new.city, new.phone, new.email) then
    return null;
  end if;

  -- nur Selbständerungen des Mieters (Portal-Konto dieses Mieters)
  if not exists (select 1 from public.user_roles ur
                  where ur.user_id = v_uid
                    and ur.role = 'tenant'
                    and ur.tenant_id = new.id) then
    return null;
  end if;

  -- Konto mit Vermieter-/Team-Rechten auf diesen Mieter (z. B. Vermieter mit eigener Mieterrolle zum
  -- Testen): wie trg_tenants_protect_columns eine Vermieter-Änderung, keine Portal-Änderung
  if old.user_id = v_uid or public.has_tenant_access(old.id, 'mietverhaeltnisse', 'write') then
    return null;
  end if;

  insert into public.tenant_change_log (tenant_id, link_id, source, old_values, new_values)
  values (
    new.id,
    null,
    'tenant_portal',
    jsonb_build_object(
      'first_name', old.first_name, 'last_name', old.last_name,
      'street', old.street, 'house_number', old.house_number,
      'postal_code', old.postal_code, 'city', old.city,
      'phone', old.phone, 'email', old.email),
    jsonb_build_object(
      'first_name', new.first_name, 'last_name', new.last_name,
      'street', new.street, 'house_number', new.house_number,
      'postal_code', new.postal_code, 'city', new.city,
      'phone', new.phone, 'email', new.email)
  );
  return null;
end;
$function$;

comment on function public.tenants_log_portal_change() is
    'Trigger (AFTER UPDATE auf tenants): protokolliert Selbständerungen des Mieters im Mieterportal in tenant_change_log (source tenant_portal).';

-- Trigger-Funktion: kein EXECUTE für App-Rollen nötig (wird nur beim Anlegen des Triggers geprüft)
revoke execute on function public.tenants_log_portal_change() from public, anon, authenticated;
grant execute on function public.tenants_log_portal_change() to service_role;

drop trigger if exists trg_tenants_portal_change_log on public.tenants;
create trigger trg_tenants_portal_change_log
    after update on public.tenants
    for each row
    when (old.first_name is distinct from new.first_name
          or old.last_name is distinct from new.last_name
          or old.street is distinct from new.street
          or old.house_number is distinct from new.house_number
          or old.postal_code is distinct from new.postal_code
          or old.city is distinct from new.city
          or old.phone is distinct from new.phone
          or old.email is distinct from new.email)
    execute function public.tenants_log_portal_change();

comment on table public.tenant_change_log is
    'Änderungsprotokoll der Mieter-Stammdaten: Aktualisierung über den Mieterdaten-Link (source token_link, '
    'geschrieben von update_tenant_by_token) und Selbständerungen im Mieterportal (source tenant_portal, '
    'Trigger trg_tenants_portal_change_log). App-Konten dürfen nur lesen.';
