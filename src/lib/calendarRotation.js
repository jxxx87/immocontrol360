// Rotation der Objektkalender-Termine (Treppenhausreinigung, Mülltermine) über die Einheiten eines Objekts.
// Zuständig sind nur Einheiten, die am Termin vermietet sind (laufender Mietvertrag); Ferienwohnungen
// und leerstehende Einheiten werden übersprungen (C-10). Die Reihenfolge bleibt die der Einheitenliste.

// Gleiche Regel wie Objekte/Investor-Kennzahlen: Status aktiv und Stichtag im Vertragszeitraum (inklusive)
export const isLeaseActiveOn = (lease, iso) =>
    !!lease &&
    lease.status === 'active' &&
    (!lease.start_date || lease.start_date <= iso) &&
    (!lease.end_date || lease.end_date >= iso);

/**
 * Prüfung (unit, iso) => „Einheit ist an diesem Tag vermietet“.
 * leasesByUnit: { [unitId]: lease[] }; null = Mietverträge nicht geladen → null (keine Filterung möglich).
 */
export const buildOccupancyCheck = (leasesByUnit) => {
    if (!leasesByUnit) return null;
    return (unit, iso) => !!unit && !unit.is_vacation_rental
        && (leasesByUnit[unit.id] || []).some(l => isLeaseActiveOn(l, iso));
};

/**
 * Nächste zuständige Einheit ab Position startIdx der Rotation (reihum in der Reihenfolge von units).
 * isEligible = null: jede Einheit kommt in Frage (bisheriges Verhalten).
 * Ergebnis { unit, nextIdx }: nextIdx = Position nach der gewählten Einheit; unit = null, wenn an diesem
 * Tag keine Einheit in Frage kommt (die Rotation bleibt dann stehen).
 */
export const pickRotationUnit = (units, startIdx, iso, isEligible = null) => {
    const n = units?.length || 0;
    if (!n) return { unit: null, nextIdx: startIdx };
    const base = ((Math.trunc(startIdx) || 0) % n + n) % n;
    for (let k = 0; k < n; k++) {
        const unit = units[(base + k) % n];
        if (!isEligible || isEligible(unit, iso)) return { unit, nextIdx: base + k + 1 };
    }
    return { unit: null, nextIdx: startIdx };
};

/** Kommt an mindestens einem der Termine eine Einheit in Frage? (sonst wird über alle Einheiten rotiert) */
export const anyUnitEligible = (units, isoDates, isEligible) =>
    !!isEligible && (isoDates || []).some(iso => (units || []).some(u => isEligible(u, iso)));
