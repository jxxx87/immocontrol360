// =============================================================================
// Zählerwechsel – gemeinsame Kennzeichnung für Zählerseite (Meters.jsx) und
// Nebenkostenabrechnung (computeMeterConsumption in utilitySettlement.js).
//
// Ein Wechsel wird ohne Schemaänderung als zwei Stände am selben Tag gespeichert:
// Endstand des alten Zählers (optional) und danach der Anfangsstand des neuen
// Zählers, dessen Notiz mit METER_SWAP_NOTE beginnt.
// =============================================================================

export const METER_SWAP_NOTE = 'Zählerwechsel:';

export const isMeterSwapStart = (r) => typeof r?.note === 'string' && r.note.startsWith(METER_SWAP_NOTE);

// Aufsteigende Reihenfolge: Ablesedatum; am selben Tag der Anfangsstand nach einem Wechsel zuletzt
// (auch wenn der Endstand alt später nachgetragen wurde), sonst Erfassungszeit, dann id.
export const compareMeterReadings = (a, b) => String(a.reading_date || '').slice(0, 10).localeCompare(String(b.reading_date || '').slice(0, 10))
    || (isMeterSwapStart(a) ? 1 : 0) - (isMeterSwapStart(b) ? 1 : 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || ''))
    || String(a.id ?? '').localeCompare(String(b.id ?? ''));
