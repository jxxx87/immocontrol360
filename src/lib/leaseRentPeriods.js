import { supabase } from './supabase';

// =============================================================================
// Mietverhältnisse: Miethistorie ("gültig ab"), Laufzeit-Status, Lösch- und
// Überschneidungsprüfung. Gemeinsam genutzt von Tenants.jsx und TenantDetail.jsx.
//
// Die Tabelle lease_rent_periods kommt mit der DB-Migration 100900_rent_history.
// Solange sie fehlt, arbeitet die App im bisherigen Modus (Werte direkt am Vertrag,
// mit deutlichem Warnhinweis, weil die Datenbank dann alle Monate neu berechnet).
// =============================================================================

export const RENT_PERIOD_FIELDS = ['cold_rent', 'service_charge', 'heating_cost', 'other_costs', 'payment_due_day'];

const FAR_FUTURE = '9999-12-31';

// Lokales Kalenderdatum (YYYY-MM-DD). toISOString() liefert UTC und damit in
// Deutschland zwischen 0 und 1/2 Uhr noch den Vortag.
export const localISODate = (date = new Date()) => {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

// Erster Tag des Monats eines ISO-Datums
export const monthStart = (iso) => (iso ? `${String(iso).slice(0, 7)}-01` : null);

// Erster Tag des Monats, verschoben um n Monate
export const addMonths = (iso, months) => {
    const [y, m] = String(iso).slice(0, 7).split('-').map(Number);
    return localISODate(new Date(y, m - 1 + months, 1));
};

// 'YYYY-MM-DD' -> 'TT.MM.JJJJ' ohne Zeitzonen-Verschiebung
export const formatDateDE = (iso, fallback = '—') => {
    if (!iso) return fallback;
    const s = String(iso).slice(0, 10);
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return fallback;
    return `${d}.${m}.${y}`;
};

export const formatMonthDE = (iso, fallback = '—') => {
    if (!iso) return fallback;
    const [y, m] = String(iso).slice(0, 7).split('-');
    return `${m}/${y}`;
};

export const formatEUR = (amount) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(parseFloat(amount) || 0);

export const isValidISODate = (iso) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return false;
    const [y, m, d] = String(iso).split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

// Fehler "Tabelle/Spalte/Funktion existiert (noch) nicht"
export const isMissingSchemaError = (error) => {
    if (!error) return false;
    const code = String(error.code || '');
    if (['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST202', '42883'].includes(code)) return true;
    const msg = String(error.message || '').toLowerCase();
    return msg.includes('could not find the table') || (msg.includes('does not exist') && msg.includes('lease_rent_periods'));
};

export const sumRent = (values) =>
    (parseFloat(values?.cold_rent) || 0) +
    (parseFloat(values?.service_charge) || 0) +
    (parseFloat(values?.heating_cost) || 0) +
    (parseFloat(values?.other_costs) || 0);

// Laufzeit-Status eines Vertrags, ausschließlich aus den Daten abgeleitet:
//  'ended'   – Vertragsende liegt in der Vergangenheit (oder beendet ohne Enddatum)
//  'future'  – Mietbeginn liegt in der Zukunft
//  'running' – läuft heute (ggf. gekündigt zum Enddatum)
export const getLeaseTimeState = (lease, today = localISODate()) => {
    if (!lease) return 'none';
    if (lease.end_date && lease.end_date < today) return 'ended';
    if (lease.status && lease.status !== 'active' && !lease.end_date) return 'ended';
    if (lease.start_date && lease.start_date > today) return 'future';
    return 'running';
};

// -----------------------------------------------------------------------------
// Miethistorie
// -----------------------------------------------------------------------------

// supported: true  -> Tabelle vorhanden, periods enthält alle Zeiträume (aufsteigend)
//            false -> Tabelle fehlt (Migration noch nicht eingespielt)
//            null  -> Laden fehlgeschlagen (error gesetzt)
export const fetchRentPeriods = async (leaseId) => {
    const { data, error } = await supabase
        .from('lease_rent_periods')
        .select('id, lease_id, valid_from, cold_rent, service_charge, heating_cost, other_costs, payment_due_day, created_at')
        .eq('lease_id', leaseId)
        .order('valid_from', { ascending: true });

    if (error) {
        if (isMissingSchemaError(error)) return { supported: false, periods: [], error: null };
        return { supported: null, periods: [], error };
    }
    return { supported: true, periods: data || [], error: null };
};

// Für ein Datum gültiger Zeitraum (letzter mit Monat(valid_from) <= Monat; davor der erste)
export const getEffectivePeriod = (periods, isoDate = localISODate()) => {
    if (!periods || periods.length === 0) return null;
    const m = monthStart(isoDate);
    let effective = null;
    periods.forEach(p => {
        if (monthStart(p.valid_from) <= m) effective = p;
    });
    return effective || periods[0];
};

// Mietänderung speichern.
//  - validFrom wird auf den Monatsersten gesetzt (das Mietkonto ist monatsgenau)
//  - liegt der Monat am oder vor dem ersten Zeitraum bzw. dem Mietbeginn, wird die
//    Anfangsmiete korrigiert (gilt dann ab Vertragsbeginn)
//  - gibt es im Monat schon einen Zeitraum, wird er angepasst, sonst neu angelegt
export const saveRentPeriod = async ({ leaseId, periods, validFrom, leaseStartDate, values }) => {
    const target = monthStart(validFrom);
    const first = periods && periods.length > 0 ? periods[0] : null;
    const startMonth = monthStart(leaseStartDate);

    let existing = null;
    if (first && (target <= monthStart(first.valid_from) || (startMonth && target <= startMonth))) {
        existing = first;
    } else {
        existing = (periods || []).find(p => monthStart(p.valid_from) === target) || null;
    }

    const payload = {
        cold_rent: parseFloat(values.cold_rent) || 0,
        service_charge: parseFloat(values.service_charge) || 0,
        heating_cost: parseFloat(values.heating_cost) || 0,
        other_costs: parseFloat(values.other_costs) || 0,
        payment_due_day: parseInt(values.payment_due_day, 10) || 3
    };

    if (existing) {
        const { data, error } = await supabase
            .from('lease_rent_periods')
            .update(payload)
            .eq('id', existing.id)
            .select('id');
        if (error) return { error, corrected: existing === first };
        if (!data || data.length === 0) {
            return { error: new Error('Die Mietänderung konnte nicht gespeichert werden (keine Berechtigung).'), corrected: existing === first };
        }
        return { error: null, corrected: existing === first };
    }

    const { error } = await supabase
        .from('lease_rent_periods')
        .insert([{ lease_id: leaseId, valid_from: target, ...payload }]);
    return { error, corrected: false };
};

export const deleteRentPeriod = async (periodId) => {
    const { data, error } = await supabase
        .from('lease_rent_periods')
        .delete()
        .eq('id', periodId)
        .select('id');
    if (error) return { error };
    if (!data || data.length === 0) {
        return { error: new Error('Dieser Zeitraum kann nicht gelöscht werden (Anfangsmiete oder keine Berechtigung).') };
    }
    return { error: null };
};

// -----------------------------------------------------------------------------
// Löschen eines Mietverhältnisses: nur ohne Zahlungen, Forderungen und manuell
// gebuchte Sollstellungen (sonst gingen buchhaltungsrelevante Daten per Kaskade verloren)
// -----------------------------------------------------------------------------
export const checkLeaseDeletion = async (leaseId) => {
    const [payRes, claimRes, ledgerRes] = await Promise.all([
        supabase.from('rent_payments').select('id', { count: 'exact', head: true }).eq('lease_id', leaseId),
        supabase.from('claims').select('id', { count: 'exact', head: true }).eq('lease_id', leaseId),
        supabase.from('rent_ledger').select('id, paid_amount, status').eq('lease_id', leaseId)
    ]);

    const error = payRes.error || claimRes.error || ledgerRes.error;
    if (error) return { ok: false, error };

    const ledgerRows = ledgerRes.data || [];
    const bookedLedger = ledgerRows.filter(r => (parseFloat(r.paid_amount) || 0) > 0 || r.status === 'loss').length;
    const payments = payRes.count || 0;
    const claims = claimRes.count || 0;

    return {
        ok: true,
        payments,
        claims,
        ledgerRows: ledgerRows.length,
        bookedLedger,
        blocked: payments > 0 || claims > 0 || bookedLedger > 0
    };
};

export const describeDeletionBlock = (info) => {
    const parts = [];
    if (info.payments > 0) parts.push(`${info.payments} Mietzahlung${info.payments === 1 ? '' : 'en'}`);
    if (info.claims > 0) parts.push(`${info.claims} Forderung${info.claims === 1 ? '' : 'en'}`);
    if (info.bookedLedger > 0 && info.payments === 0) parts.push(`${info.bookedLedger} bearbeitete Sollstellung${info.bookedLedger === 1 ? '' : 'en'}`);
    return `Dieses Mietverhältnis kann nicht gelöscht werden: Es liegen bereits Buchungen vor (${parts.join(', ')}). ` +
        'Beim Löschen gingen Zahlungshistorie und Mietkonto unwiderruflich verloren (Aufbewahrungspflicht für Buchungsunterlagen).' +
        '\n\nBitte beenden Sie das Mietverhältnis stattdessen in der Mieterakte – die Historie bleibt dann erhalten.';
};

export const deletionConfirmText = (info) =>
    'Mietverhältnis unwiderruflich löschen?\n\n' +
    'Es sind keine Zahlungen und keine Forderungen erfasst. ' +
    (info.ledgerRows > 0
        ? `Mit dem Vertrag werden ${info.ledgerRows} automatisch erzeugte Sollstellung${info.ledgerRows === 1 ? '' : 'en'} gelöscht. `
        : '') +
    'Der Mieter-Datensatz selbst bleibt erhalten.';

export const translateLeaseDeleteError = (error) => {
    if (!error) return '';
    if (String(error.code) === '23503') {
        return 'Das Mietverhältnis kann nicht gelöscht werden, weil noch Forderungen oder andere Datensätze darauf verweisen. Bitte beenden Sie das Mietverhältnis stattdessen.';
    }
    return error.message || String(error);
};

// -----------------------------------------------------------------------------
// Überschneidung mit anderen Verträgen derselben Einheit
// -----------------------------------------------------------------------------
export const findOverlappingLeases = async ({ unitId, startDate, endDate, excludeLeaseId = null }) => {
    const { data, error } = await supabase
        .from('leases')
        .select('id, start_date, end_date, status, tenant:tenants(first_name, last_name)')
        .eq('unit_id', unitId);

    if (error) return { error, overlaps: [] };

    const s2 = startDate;
    const e2 = endDate || FAR_FUTURE;
    const overlaps = (data || [])
        .filter(l => l.id !== excludeLeaseId)
        // beendet ohne Enddatum (Altdaten): zählt nicht als belegt
        .filter(l => !(l.status && l.status !== 'active' && !l.end_date))
        .filter(l => l.start_date <= e2 && s2 <= (l.end_date || FAR_FUTURE));

    return { error: null, overlaps };
};

export const describeLease = (l) => {
    const name = [l?.tenant?.last_name, l?.tenant?.first_name].filter(Boolean).join(', ') || 'Ohne Mieter';
    return `${name} (${formatDateDE(l?.start_date)} – ${l?.end_date ? formatDateDE(l.end_date) : 'unbefristet'})`;
};

// -----------------------------------------------------------------------------
// Daten für "Dokument erstellen" (Vorlagen-Editor). Nur vorhandene Spalten.
// Anschrift: Kontaktadresse des Mieters, sonst die Adresse des Mietobjekts.
// -----------------------------------------------------------------------------
export const buildTemplateTenantData = ({ lease, tenant, unit, property }) => {
    const t = tenant || {};
    const p = property || {};
    const hasOwnAddress = !!(t.street && t.city);
    const objektLabel = p.object_key || [p.street, p.house_number].filter(Boolean).join(' ');

    return {
        first_name: t.first_name || '',
        last_name: t.last_name || '',
        street: hasOwnAddress ? t.street : (p.street || ''),
        house_number: hasOwnAddress ? (t.house_number || '') : (p.house_number || ''),
        zip: hasOwnAddress ? (t.postal_code || '') : (p.zip || ''),
        city: hasOwnAddress ? t.city : (p.city || ''),
        objekt_name: objektLabel || '',
        objekt_strasse: p.street || '',
        objekt_hausnummer: p.house_number || '',
        objekt_plz: p.zip || '',
        objekt_ort: p.city || '',
        einheit_name: unit?.unit_name || '',
        cold_rent: lease?.cold_rent ?? '',
        service_charge: lease?.service_charge ?? '',
        heating_cost: lease?.heating_cost ?? '',
        other_costs: lease?.other_costs ?? '',
        deposit: lease?.deposit ?? '',
        start_date: lease?.start_date || null,
        end_date: lease?.end_date || null,
        lease_type: lease?.lease_type || 'normal',
        last_rent_increase: lease?.last_rent_increase || null,
        lease_id: lease?.id || null,
        // lease.unit_id zuerst: Zusatzzeilen der Übersicht tragen eine zusammengesetzte Zeilen-ID
        unit_id: lease?.unit_id || unit?.id || null,
        property_id: p.id || null,
        portfolio_id: p.portfolio_id || null
    };
};
