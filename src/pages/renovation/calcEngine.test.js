/**
 * Unit-Tests der Sanierungs-Berechnungs-Engine (reine Rechenlogik, kein Supabase).
 *
 * Geometrie-Ansatz der Engine (siehe Kopfkommentar/Code):
 *   Wandfläche Raum = Umfang eines flächengleichen Quadrats × Geschosshöhe = 4·√A·h
 *   Dachfläche (geneigt) = Grundfläche / cos(Neigung), Neigung auf 5°…70° begrenzt
 *   Fassade = Gebäudeumfang × (Etagen × Geschosshöhe)
 *   GP = Menge × EP, kaufmännisch auf Cent gerundet
 */
import { describe, it, expect } from 'vitest';
import {
    generateCalcLines, recalcGP, resolvePositionKey,
    STANDARD_POSITION_KEYS, ALTERNATIVE_GROUPS,
} from './calcEngine';

/* ─── Testhelfer ─── */

/** Katalog mit ALLEN Standardpositionen in einem Gewerk; Preis je Schlüssel überschreibbar. */
const fullCatalog = (prices = {}, { defaultPrice = 10, omit = [] } = {}) => [{
    name: 'Alle Gewerke',
    subtrades: [{
        name: 'Standard',
        positions: Object.entries(STANDARD_POSITION_KEYS)
            .filter(([, key]) => !omit.includes(key))
            .map(([name, key]) => ({
                id: `pos_${key}`, name, unit: 'm²',
                price: key in prices ? prices[key] : defaultPrice,
            })),
    }],
}];

const byKey = (lines, key) => {
    const l = lines.find(x => x.key === key);
    if (!l) throw new Error(`Zeile für ${key} fehlt`);
    return l;
};
const qty = (lines, key) => byKey(lines, key).qty;

/** Wohnung: 1 Zimmer 16 m² (Parkett neu), 1 Bad 4 m² mit Dusche + 1 Waschtisch, 1 Fenster 100×120 cm. */
const wohnungParams = (overrides = {}) => ({
    buildingType: 'wohnung',
    floorHeight: 2.5,
    floors: [{
        whgs: [{
            rooms: [{ name: 'Wohnzimmer', sqm: 16, currentFlooring: 'Laminat/Vinyl/Parkett', flooring: 'Parkett' }],
            bathrooms: [{ sqm: 4, wallTiles: '1.2m', shower: true, bathtub: false, sinkCount: 1, urinalBidetCount: 0, washingMachine: false }],
            windows: [{ width: 100, height: 120 }],
        }],
    }],
    userTrades: fullCatalog(),
    ...overrides,
});

/** EFH 10 × 12 m, 2 Etagen à 2,5 m, Satteldach 45°, 2 Gauben. EG: Küche 25 m² (Fliesen→Fliesen), OG: Schlafzimmer 16 m² (Teppich→Laminat). */
const efhParams = (overrides = {}) => ({
    buildingType: 'efh',
    floorHeight: 2.5,
    floorCount: 2,
    unitCount: 3, // wird bei EFH ignoriert (numUnits = 1)
    houseWidth: 10,
    houseLength: 12,
    roofType: 'satteldach',
    roofAngle: 45,
    gaubenCount: 2,
    floors: [
        { whgs: [{ rooms: [{ name: 'Küche', sqm: 25, currentFlooring: 'Fliesen', flooring: 'Fliesen' }], bathrooms: [], windows: [] }] },
        { whgs: [{ rooms: [{ name: 'Schlafzimmer', sqm: 16, currentFlooring: 'Teppich', flooring: 'Laminat' }], bathrooms: [], windows: [] }] },
    ],
    userTrades: fullCatalog({ geruest: 12, dachfangnetz: 8, waermepumpe: 18000 }),
    ...overrides,
});

/* ─── resolvePositionKey ─── */

describe('resolvePositionKey – stabile Zuordnung Katalogposition → Mengenschlüssel', () => {
    it('nutzt einen bekannten key auch nach Umbenennung der Position', () => {
        expect(resolvePositionKey({ key: 'parkett', name: 'Eiche Landhausdiele verlegen' })).toBe('parkett');
    });

    it('erkennt ältere Katalogpositionen ohne key über den Standardnamen (Leerzeichen getrimmt)', () => {
        expect(resolvePositionKey({ name: 'Parkett verlegen' })).toBe('parkett');
        expect(resolvePositionKey({ name: '  Gipsputz  ' })).toBe('gipsputz');
    });

    it('fällt bei unbekanntem key auf den Standardnamen zurück', () => {
        expect(resolvePositionKey({ key: 'gibt_es_nicht', name: 'Gastherme' })).toBe('gastherme');
    });

    it('liefert null für eigene Positionen, leere Eingaben und null', () => {
        expect(resolvePositionKey({ name: 'Kaminofen setzen' })).toBeNull();
        expect(resolvePositionKey({})).toBeNull();
        expect(resolvePositionKey(null)).toBeNull();
        expect(resolvePositionKey(undefined)).toBeNull();
    });
});

describe('Katalog-Konsistenz', () => {
    it('jede Variante der Alternativgruppen verweist auf einen existierenden Standardschlüssel', () => {
        // Sonst hätte die Variantenwahl keine Wirkung (Zeile würde nie gefunden)
        const known = new Set(Object.values(STANDARD_POSITION_KEYS));
        for (const group of ALTERNATIVE_GROUPS) {
            expect(group.options[group.defaultOption], `${group.id}: defaultOption`).toBeDefined();
            for (const keys of Object.values(group.options)) {
                for (const k of keys) expect(known.has(k), `${group.id}: ${k}`).toBe(true);
            }
        }
    });

    it('Standardschlüssel sind eindeutig (keine zwei Namen auf denselben key)', () => {
        const keys = Object.values(STANDARD_POSITION_KEYS);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

/* ─── Wohnung: Mengenermittlung ─── */

describe('generateCalcLines – Wohnung (Zimmer 16 m² + Bad 4 m², h = 2,5 m)', () => {
    const lines = generateCalcLines(wohnungParams());

    it('erzeugt je Katalogposition genau eine Zeile', () => {
        expect(lines).toHaveLength(Object.keys(STANDARD_POSITION_KEYS).length);
    });

    it('Bodenflächen: Estrich-Abbruch = Zimmer + Bad, alter Belag nur Zimmer', () => {
        expect(qty(lines, 'abbruch_estrich')).toBe(20);       // 16 + 4
        expect(qty(lines, 'abbruch_bodenbelag')).toBe(16);    // Ist-Belag ≠ Fliesen
        expect(qty(lines, 'entsorgung_bodenbelag')).toBe(16);
        expect(qty(lines, 'abbruch_fliesen')).toBe(0);        // keine Ist-Fliesen im Zimmer
        expect(byKey(lines, 'abbruch_fliesen').enabled).toBe(false);
    });

    it('Wandflächen nach Quadrat-Umfang-Ansatz 4·√A·h', () => {
        expect(qty(lines, 'gipsputz')).toBe(40);         // Zimmer: 4·√16·2,5 = 4·4·2,5
        expect(qty(lines, 'kalkzementputz')).toBe(20);   // Bad:    4·√4·2,5  = 4·2·2,5
        expect(qty(lines, 'raufaser')).toBe(40);
        expect(qty(lines, 'innenanstrich')).toBe(40);
        // Tapeten entfernen = Wände Zimmer + Wände Bad + alle Decken = 40 + 20 + 20
        expect(qty(lines, 'abbruch_tapeten')).toBe(80);
        // Q3-Spachtelung = Wände Zimmer + Decken Zimmer + Decke Bad = 40 + 16 + 4
        expect(qty(lines, 'spachtelung_q3')).toBe(60);
        expect(qty(lines, 'deckenabhaengung')).toBe(20);
    });

    it('Bauschutt = 0,1 m³/m² Estrich + 0,03 m³/m² Ist-Fliesen', () => {
        expect(qty(lines, 'entsorgung_bauschutt')).toBe(2); // 20 · 0,1 + 0 · 0,03
    });

    it('Bad mit Fliesenspiegel 1,20 m und Dusche (3 Wandseiten à 1 m bis zur Decke)', () => {
        // Umfang 4·√4 = 8 m; Spiegel 8 · 1,2 = 9,6 m²; Dusche oberhalb 3 · (2,5 − 1,2) = 3,9 m²
        expect(qty(lines, 'wandfliesen')).toBe(13.5);
        // Restwand Bad = 8 · 2,5 − 13,5 = 6,5 m² (bei Wohnung keine Pauschale 50 m²/Etage)
        expect(qty(lines, 'scheibenputz')).toBe(6.5);
        // Abdichtung = Badboden 4 m² + Dusche 3 · 2,5 = 11,5 m²
        expect(qty(lines, 'abdichtung')).toBe(11.5);
        // Bodenfliesen SOLL: Bad immer gefliest (4) + Zimmer mit Fliesen (0)
        expect(qty(lines, 'bodenfliesen')).toBe(4);
    });

    it('Sanitärobjekte und Abwasseranschlüsse (inkl. 1 WC je Bad)', () => {
        expect(qty(lines, 'abwasser')).toBe(3);      // Dusche 1 + Waschtisch 1 + WC 1
        expect(qty(lines, 'vorwand_wc')).toBe(1);
        expect(qty(lines, 'wc_anlage')).toBe(1);
        expect(qty(lines, 'waschtisch')).toBe(1);
        expect(qty(lines, 'dusche')).toBe(1);
        expect(qty(lines, 'estrich_dusche')).toBe(1);
        expect(qty(lines, 'badewanne')).toBe(0);
        expect(qty(lines, 'waschmaschinenanschluss')).toBe(0);
    });

    it('Bodenbelag SOLL Parkett mit Sockelleisten = Umfang 4·√16', () => {
        expect(qty(lines, 'parkett')).toBe(16);
        expect(qty(lines, 'sockelleiste')).toBe(16);
        expect(qty(lines, 'fliesensockel')).toBe(0);
        expect(qty(lines, 'laminat')).toBe(0);
    });

    it('Türen: je Zimmer und je Bad eine Innentür', () => {
        expect(qty(lines, 'innentuer_ausbauen')).toBe(2);
        expect(qty(lines, 'innentuer_cpl')).toBe(2);
        expect(qty(lines, 'uebergangsleiste')).toBe(2);
    });

    it('Elektro/Heizung je Raum (Zimmer + Bad = 2 Räume)', () => {
        expect(qty(lines, 'heizkoerper')).toBe(2);
        expect(qty(lines, 'steckdose')).toBe(8);   // 2 Räume · 4
        expect(qty(lines, 'led_spot')).toBe(8);    // 2 Räume · 4
        expect(qty(lines, 'schalter')).toBe(3);    // 2 Räume + 1 Etage
        expect(qty(lines, 'netzwerkdose')).toBe(2); // 1 Wohnung · 2
        expect(qty(lines, 'unterverteilung')).toBe(1);
    });

    it('Fenster: Fläche aus cm, Fensterbank = Breite', () => {
        expect(qty(lines, 'fenster_kunststoff')).toBe(1.2); // 1,00 m · 1,20 m
        expect(qty(lines, 'fenster_demontage')).toBe(1);
        expect(qty(lines, 'fenster_ral_montage')).toBe(1);
        expect(qty(lines, 'fensterbank_aussen')).toBe(1);
        expect(qty(lines, 'fensterbank_innen')).toBe(1);
    });

    it('gebäudebezogene Positionen (Dach, Fassade, Gerüst, Haustür, Keller, WP) sind bei Wohnung 0', () => {
        for (const key of ['dachstuhl', 'dacheindeckung_ziegel', 'geruest', 'dachfangnetz', 'geruest_standzeit',
            'wdvs', 'fassadenputz', 'haustuer', 'kellerdaemmung', 'waermepumpe', 'gaube', 'dachrinne', 'fallrohr']) {
            expect(qty(lines, key), key).toBe(0);
            expect(byKey(lines, key).enabled, key).toBe(false);
        }
    });

    it('Wohnung: kein Wärmeerzeuger vorausgewählt – Gastherme hat Menge 1, ist aber abgewählt', () => {
        expect(qty(lines, 'gastherme')).toBe(1);
        expect(byKey(lines, 'gastherme').enabled).toBe(false);
        expect(byKey(lines, 'gastherme').alternativeGroup).toBe('waermeerzeuger');
    });

    it('Standardvarianten: Zementestrich, Raufaser, Türaustausch, Heizkörper, einfache Deckenbeplankung', () => {
        expect(byKey(lines, 'estrich_zement').enabled).toBe(true);
        expect(byKey(lines, 'estrich_fliess').enabled).toBe(false);
        expect(byKey(lines, 'estrich_trocken').enabled).toBe(false);
        // abgewählte Alternativen behalten ihre Menge (umschaltbar)
        expect(qty(lines, 'estrich_fliess')).toBe(20);
        expect(byKey(lines, 'raufaser').enabled).toBe(true);
        expect(byKey(lines, 'malervlies').enabled).toBe(false);
        expect(byKey(lines, 'innentuer_cpl').enabled).toBe(true);
        expect(byKey(lines, 'tueren_lackieren').enabled).toBe(false);
        expect(byKey(lines, 'heizkoerper').enabled).toBe(true);
        expect(byKey(lines, 'fussbodenheizung').enabled).toBe(false);
        expect(byKey(lines, 'beplankung_decke_einfach').enabled).toBe(true);
        expect(byKey(lines, 'beplankung_decke_zweifach').enabled).toBe(false);
    });

    it('Positionen ohne Mengenansatz (z. B. Innenwand abbrechen) haben Menge 0 und sind abgewählt', () => {
        const l = byKey(lines, 'abbruch_innenwand');
        expect(l.qty).toBe(0);
        expect(l.gp).toBe(0);
        expect(l.enabled).toBe(false);
    });

    it('alle Mengen und Preise sind endliche Zahlen (kein NaN)', () => {
        for (const l of lines) {
            expect(Number.isFinite(l.qty), l.key).toBe(true);
            expect(Number.isFinite(l.ep), l.key).toBe(true);
            expect(Number.isFinite(l.gp), l.key).toBe(true);
        }
    });
});

/* ─── Preise / Gesamtpreise ─── */

describe('generateCalcLines – Einzelpreis × Menge = Gesamtpreis (Cent)', () => {
    it('GP = Menge × EP aus der Preisliste', () => {
        const lines = generateCalcLines(wohnungParams({ userTrades: fullCatalog({ parkett: 39.99 }) }));
        const l = byKey(lines, 'parkett');
        expect(l.ep).toBe(39.99);
        expect(l.gp).toBe(639.84); // 16 m² · 39,99 €
    });

    it('rundet kaufmännisch auf Cent: 2,5 m² × 19,99 € = 49,975 € → 49,98 €', () => {
        // Fenster 100 × 250 cm = 2,5 m²; in Gleitkomma ist 2,5 · 19,99 = 49,97499999…
        const params = wohnungParams({ userTrades: fullCatalog({ fenster_kunststoff: 19.99 }) });
        params.floors[0].whgs[0].windows = [{ width: 100, height: 250 }];
        const l = byKey(generateCalcLines(params), 'fenster_kunststoff');
        expect(l.qty).toBe(2.5);
        expect(l.gp).toBe(49.98);
    });

    it('Mengen werden auf 2 Nachkommastellen gerundet (Zimmer 10 m²: 4·√10·2,5 = 31,6228 → 31,62)', () => {
        const params = wohnungParams();
        params.floors[0].whgs[0].rooms = [{ name: 'Zimmer', sqm: 10, flooring: 'Parkett' }];
        expect(qty(generateCalcLines(params), 'gipsputz')).toBe(31.62);
    });

    it('fehlender Preis in der Position → EP 0, GP 0', () => {
        const trades = [{ name: 'Maler', subtrades: [{ name: 'Wand', positions: [{ name: 'Raufaser tapezieren' }] }] }];
        const l = generateCalcLines(wohnungParams({ userTrades: trades }))[0];
        expect(l.qty).toBe(40);
        expect(l.ep).toBe(0);
        expect(l.gp).toBe(0);
    });
});

/* ─── Zeilenaufbau ─── */

describe('generateCalcLines – Zeilenaufbau', () => {
    const trades = [{
        name: 'Sonstiges',
        subtrades: [{
            name: 'Extra',
            positions: [
                { name: 'Kaminofen setzen', price: 1500 },                                  // eigene Position
                { id: 'p1', key: 'parkett', name: 'Eiche Landhausdiele', unit: 'm²', price: 50 }, // umbenannt
            ],
        }],
    }];
    const lines = generateCalcLines(wohnungParams({ userTrades: trades }));

    it('eigene Positionen ohne Schlüssel: Menge 0, Preis übernommen, abgewählt, Einheit Stk., ID aus Namen', () => {
        expect(lines[0]).toEqual({
            id: 'Sonstiges_Extra_Kaminofen_setzen',
            key: null,
            trade: 'Sonstiges',
            subtrade: 'Extra',
            position: 'Kaminofen setzen',
            unit: 'Stk.',
            ep: 1500,
            qty: 0,
            gp: 0,
            enabled: false,
        });
    });

    it('umbenannte Position behält über den key ihre Menge', () => {
        expect(lines[1]).toMatchObject({ id: 'p1', key: 'parkett', position: 'Eiche Landhausdiele', unit: 'm²', qty: 16, ep: 50, gp: 800, enabled: true });
        expect(lines[1].alternativeGroup).toBeUndefined();
    });

    it('ohne Gewerke keine Zeilen; leere Parameter brechen nicht', () => {
        expect(generateCalcLines({})).toEqual([]);
        expect(generateCalcLines({ floors: [], userTrades: [] })).toEqual([]);
    });
});

/* ─── Randfälle Eingaben ─── */

describe('generateCalcLines – Randfälle der Eingaben', () => {
    it('fehlende/null-Flächen zählen als 0', () => {
        const params = wohnungParams();
        params.floors[0].whgs[0].rooms = [{ name: 'Zimmer', sqm: null, flooring: 'Parkett' }, { name: 'Zimmer 2', flooring: 'Parkett' }];
        params.floors[0].whgs[0].bathrooms = [];
        const lines = generateCalcLines(params);
        expect(qty(lines, 'abbruch_estrich')).toBe(0);
        expect(qty(lines, 'gipsputz')).toBe(0);
        expect(qty(lines, 'heizkoerper')).toBe(2); // Räume werden trotzdem gezählt
    });

    it('eine negative Fläche zählt als 0 und verfälscht die übrigen Räume nicht', () => {
        // Vorher: √(−4) = NaN → Wandflächen ALLER Räume wurden 0
        const params = wohnungParams();
        params.floors[0].whgs[0].rooms = [
            { name: 'Zimmer', sqm: 16, flooring: 'Parkett' },
            { name: 'Tippfehler', sqm: -4, flooring: 'Parkett' },
        ];
        params.floors[0].whgs[0].bathrooms = [];
        const lines = generateCalcLines(params);
        expect(qty(lines, 'gipsputz')).toBe(40);        // nur 4·√16·2,5
        expect(qty(lines, 'abbruch_estrich')).toBe(16); // −4 nicht abgezogen
        expect(qty(lines, 'parkett')).toBe(16);
    });

    it('negative Fenstermaße zählen als 0 (keine positive Fläche aus (−)·(−))', () => {
        const params = wohnungParams();
        params.floors[0].whgs[0].windows = [{ width: -100, height: -120 }, { width: 150, height: 140 }];
        const lines = generateCalcLines(params);
        expect(qty(lines, 'fenster_kunststoff')).toBe(2.1); // nur 1,5 · 1,4
        expect(qty(lines, 'fensterbank_aussen')).toBe(1.5);
        expect(qty(lines, 'fenster_demontage')).toBe(2);    // Stückzahl bleibt
    });

    it('Diele/Flur/Korridor (Groß-/Kleinschreibung egal) bekommen keine Innentür', () => {
        const params = wohnungParams();
        params.floors[0].whgs[0].rooms = ['Wohnzimmer', 'Flur', 'DIELE', 'Korridor Nord', 'Schlafzimmer']
            .map(name => ({ name, sqm: 9, flooring: 'Parkett' }));
        const lines = generateCalcLines(params);
        expect(qty(lines, 'innentuer_ausbauen')).toBe(3); // Wohnzimmer + Schlafzimmer + Bad
        expect(qty(lines, 'tueren_lackieren')).toBe(3);
        expect(qty(lines, 'heizkoerper')).toBe(6);        // Heizkörper aber in allen 5 Räumen + Bad
    });

    it('raumhoch gefliestes Bad: Wandfliesen = gesamte Wand, kein Scheibenputz', () => {
        const params = wohnungParams();
        params.floors[0].whgs[0].bathrooms = [{ sqm: 4, wallTiles: 'raumhoch', shower: true, sinkCount: 1 }];
        const lines = generateCalcLines(params);
        expect(qty(lines, 'wandfliesen')).toBe(20); // 8 m · 2,5 m, Dusche ist enthalten
        expect(qty(lines, 'scheibenputz')).toBe(0);
    });

    it('Fliesenspiegel ohne Dusche: nur 1,20 m rundum', () => {
        const params = wohnungParams();
        params.floors[0].whgs[0].bathrooms = [{ sqm: 4, wallTiles: '1.2m', shower: false, sinkCount: 1 }];
        const lines = generateCalcLines(params);
        expect(qty(lines, 'wandfliesen')).toBe(9.6);   // 8 · 1,2
        expect(qty(lines, 'scheibenputz')).toBe(10.4); // 20 − 9,6
        expect(qty(lines, 'abdichtung')).toBe(4);      // nur Badboden
    });

    it('Geschosshöhe unter 1,20 m: Fliesenspiegel auf Raumhöhe begrenzt, keine negative Restwand', () => {
        const params = wohnungParams({ floorHeight: 1.0 });
        const lines = generateCalcLines(params);
        // Umfang 8 · 1,0 = 8 m²; Dusche oberhalb 3 · max(0, 1,0 − 1,0) = 0
        expect(qty(lines, 'wandfliesen')).toBe(8);
        expect(qty(lines, 'scheibenputz')).toBe(0);
    });

    it('Bad mit Wanne, 2 Waschtischen, Bidet und Waschmaschine', () => {
        const params = wohnungParams();
        params.floors[0].whgs[0].bathrooms = [{ sqm: 6, shower: false, bathtub: true, sinkCount: 2, urinalBidetCount: 1, washingMachine: true }];
        const lines = generateCalcLines(params);
        expect(qty(lines, 'abwasser')).toBe(6);    // Wanne 1 + Waschtische 2 + Bidet 1 + WM 1 + WC 1
        expect(qty(lines, 'vorwand_wc')).toBe(2);  // WC + Bidet
        expect(qty(lines, 'waschtisch')).toBe(2);
        expect(qty(lines, 'badewanne')).toBe(1);
        expect(qty(lines, 'waschmaschinenanschluss')).toBe(1);
        expect(qty(lines, 'dusche')).toBe(0);
    });
});

/* ─── EFH / MFH ─── */

describe('generateCalcLines – EFH 10 × 12 m, 2 Etagen, Satteldach 45°', () => {
    const lines = generateCalcLines(efhParams());

    it('Fassade und Gerüst = Umfang 44 m × Höhe 5 m = 220 m²', () => {
        for (const key of ['geruest', 'wdvs', 'fassadenputz', 'fassadenanstrich']) expect(qty(lines, key), key).toBe(220);
    });

    it('Dachfläche = 120 m² / cos 45° = 169,71 m²', () => {
        for (const key of ['dachstuhl', 'dacheindeckung_ziegel', 'dachdaemmung', 'dampfbremse']) expect(qty(lines, key), key).toBe(169.71);
        expect(qty(lines, 'flachdachabdichtung')).toBe(0);
        expect(qty(lines, 'attika')).toBe(0);
    });

    it('Satteldach: Rinne an beiden Traufen (2 · 12), Fangnetz an beiden Giebeln (2 · 10), Fallrohr 2 · Höhe', () => {
        expect(qty(lines, 'dachrinne')).toBe(24);
        expect(qty(lines, 'dachfangnetz')).toBe(20);
        expect(qty(lines, 'fallrohr')).toBe(10); // 2 Etagen · 2,5 m · 2 Fallrohre
        expect(qty(lines, 'gaube')).toBe(2);
        expect(qty(lines, 'haustuer')).toBe(1);
    });

    it('Gerüst-Standzeit je Woche = 10 % der Gerüstkosten, als Pauschale (Menge 1)', () => {
        const l = byKey(lines, 'geruest_standzeit');
        // (220 m² · 12 € + 20 m · 8 €) · 10 % = (2.640 + 160) · 0,1 = 280 €
        expect(l.qty).toBe(1);
        expect(l.ep).toBe(280);
        expect(l.gp).toBe(280);
    });

    it('Standzeit nutzt Rückfallpreise 15 €/m² bzw. 10 €/m, wenn Gerüst/Fangnetz im Katalog fehlen', () => {
        const l = byKey(generateCalcLines(efhParams({ userTrades: fullCatalog({}, { omit: ['geruest', 'dachfangnetz'] }) })), 'geruest_standzeit');
        expect(l.ep).toBe(350); // (220 · 15 + 20 · 10) · 0,1
    });

    it('EFH: Wärmepumpe (Standard) zum Listenpreis ohne MFH-Zuschlag, unitCount wird ignoriert', () => {
        const wp = byKey(lines, 'waermepumpe');
        expect(wp.qty).toBe(1);
        expect(wp.ep).toBe(18000);
        expect(wp.enabled).toBe(true);
        expect(byKey(lines, 'gastherme').enabled).toBe(false);
        expect(qty(lines, 'gastherme')).toBe(1);
        expect(qty(lines, 'zaehlerschrank')).toBe(1);
    });

    it('Pauschale Scheibenputz 50 m² je Etage und Kellerdecke = EG-Fläche', () => {
        expect(qty(lines, 'scheibenputz')).toBe(100); // 50 · 2 Etagen, keine Bäder
        expect(qty(lines, 'kellerdaemmung')).toBe(25); // nur Küche im EG
    });

    it('Bodenbeläge: Ist-Fliesen werden abgebrochen, Teppich zählt als sonstiger Belag', () => {
        expect(qty(lines, 'abbruch_fliesen')).toBe(25);
        expect(qty(lines, 'abbruch_bodenbelag')).toBe(16);
        expect(qty(lines, 'entsorgung_bauschutt')).toBe(4.85); // 41 · 0,1 + 25 · 0,03
        expect(qty(lines, 'bodenfliesen')).toBe(25);
        expect(qty(lines, 'fliesensockel')).toBe(20);  // 4 · √25
        expect(qty(lines, 'laminat')).toBe(16);
        expect(qty(lines, 'sockelleiste')).toBe(16);   // 4 · √16
    });

    it('Schalter = Räume + Etagen, Netzwerkdosen 2 je Wohneinheit-Block', () => {
        expect(qty(lines, 'schalter')).toBe(4);     // 2 Räume + 2 Etagen
        expect(qty(lines, 'netzwerkdose')).toBe(4); // 2 Etagen-Blöcke · 2
    });
});

describe('generateCalcLines – Dachformen und Dachneigung', () => {
    const run = (o) => generateCalcLines(efhParams(o));

    it('Flachdach: Dachfläche = Grundfläche, Attika und Fangnetz rundum, keine Ziegel/Rinne', () => {
        const lines = run({ roofType: 'flachdach' });
        expect(qty(lines, 'flachdachabdichtung')).toBe(120);
        expect(qty(lines, 'dachstuhl')).toBe(120);
        expect(qty(lines, 'dacheindeckung_ziegel')).toBe(0);
        expect(qty(lines, 'dachdaemmung')).toBe(0);
        expect(qty(lines, 'dampfbremse')).toBe(0);
        expect(qty(lines, 'attika')).toBe(44);
        expect(qty(lines, 'dachfangnetz')).toBe(44);
        expect(qty(lines, 'dachrinne')).toBe(0);
    });

    it('Walmdach 30°: Rinne und Fangnetz rundum, Fläche 120 / cos 30° = 138,56 m²', () => {
        const lines = run({ roofType: 'walmdach', roofAngle: 30 });
        expect(qty(lines, 'dachrinne')).toBe(44);
        expect(qty(lines, 'dachfangnetz')).toBe(44);
        expect(qty(lines, 'dacheindeckung_ziegel')).toBe(138.56);
    });

    it('Neigung oberhalb 70° wird auf 70° begrenzt (120 / cos 70° = 350,86 m²)', () => {
        expect(qty(run({ roofAngle: 85 }), 'dacheindeckung_ziegel')).toBe(350.86);
    });

    it('Neigung unter 5° wird auf 5° angehoben (120 / cos 5° = 120,46 m²)', () => {
        expect(qty(run({ roofAngle: 2 }), 'dacheindeckung_ziegel')).toBe(120.46);
    });

    it('Neigung 0, leer oder ungültig → Standard 35° (120 / cos 35° = 146,49 m²)', () => {
        expect(qty(run({ roofAngle: 0 }), 'dacheindeckung_ziegel')).toBe(146.49);
        expect(qty(run({ roofAngle: 'abc' }), 'dacheindeckung_ziegel')).toBe(146.49);
        expect(qty(run({ roofAngle: undefined }), 'dacheindeckung_ziegel')).toBe(146.49);
    });

    it('ohne Hausmaße keine Dachfläche', () => {
        expect(qty(run({ houseWidth: 0 }), 'dachstuhl')).toBe(0);
    });

    it('Wohnung mit eingetragenen Hausmaßen: trotzdem keine Dach-/Fassadenmengen', () => {
        const lines = generateCalcLines(wohnungParams({ houseWidth: 10, houseLength: 12, roofType: 'satteldach' }));
        expect(qty(lines, 'dachstuhl')).toBe(0);
        expect(qty(lines, 'wdvs')).toBe(0);
        expect(qty(lines, 'dachrinne')).toBe(0);
    });
});

describe('generateCalcLines – MFH und Wärmepumpen-Zuschlag', () => {
    const mfh = (o = {}) => efhParams({ buildingType: 'mfh', unitCount: 3, floorCount: 1, ...o });

    it('MFH mit 3 Einheiten: Zähler, Unterverteilung, Sprechanlage, Gasthermen je Einheit', () => {
        const lines = generateCalcLines(mfh());
        for (const key of ['zaehlerschrank', 'unterverteilung', 'sprechanlage', 'gastherme']) expect(qty(lines, key), key).toBe(3);
    });

    it('Wärmepumpe: Listenpreis + 2.000 € je weiterer Einheit (18.000 + 2 · 2.000 = 22.000 €)', () => {
        expect(byKey(generateCalcLines(mfh()), 'waermepumpe').ep).toBe(22000);
    });

    it('bewusst auf 0 gesetzter WP-Preis bleibt 0 (kein Zuschlag, kein Ersatzpreis)', () => {
        const lines = generateCalcLines(mfh({ userTrades: fullCatalog({ waermepumpe: 0 }) }));
        expect(byKey(lines, 'waermepumpe').ep).toBe(0);
        expect(byKey(lines, 'waermepumpe').gp).toBe(0);
    });

    it('WP-Position ohne Preis → Rückfall 20.000 € + Zuschlag (20.000 + 2 · 2.000)', () => {
        const lines = generateCalcLines(mfh({ userTrades: fullCatalog({ waermepumpe: undefined }) }));
        expect(byKey(lines, 'waermepumpe').ep).toBe(24000);
    });
});

describe('generateCalcLines – Variantenwahl', () => {
    it('gewählte Varianten werden aktiv, die übrigen der Gruppe abgewählt', () => {
        const lines = generateCalcLines(wohnungParams({
            variants: { estrich: 'trocken', wandbelag: 'malervlies', innentueren: 'lackieren', heizflaechen: 'fussbodenheizung', deckenbeplankung: 'zweifach' },
        }));
        expect(byKey(lines, 'estrich_trocken').enabled).toBe(true);
        expect(byKey(lines, 'estrich_zement').enabled).toBe(false);
        expect(byKey(lines, 'malervlies').enabled).toBe(true);
        expect(byKey(lines, 'raufaser').enabled).toBe(false);
        expect(byKey(lines, 'tueren_lackieren').enabled).toBe(true);
        for (const key of ['innentuer_ausbauen', 'entsorgung_innentuer', 'innentuer_cpl']) expect(byKey(lines, key).enabled, key).toBe(false);
        expect(byKey(lines, 'fussbodenheizung').enabled).toBe(true);
        expect(qty(lines, 'fussbodenheizung')).toBe(20);
        expect(byKey(lines, 'heizkoerper').enabled).toBe(false);
        expect(byKey(lines, 'beplankung_decke_zweifach').enabled).toBe(true);
        expect(byKey(lines, 'beplankung_decke_einfach').enabled).toBe(false);
    });

    it("'keine' wählt alle Varianten einer Gruppe ab", () => {
        const lines = generateCalcLines(wohnungParams({ variants: { heizflaechen: 'keine' } }));
        expect(byKey(lines, 'heizkoerper').enabled).toBe(false);
        expect(byKey(lines, 'fussbodenheizung').enabled).toBe(false);
    });

    it('unbekannte Variante oder variants = null → Standardvariante', () => {
        for (const variants of [{ estrich: 'beton' }, null]) {
            const lines = generateCalcLines(wohnungParams({ variants }));
            expect(byKey(lines, 'estrich_zement').enabled).toBe(true);
            expect(byKey(lines, 'estrich_fliess').enabled).toBe(false);
        }
    });

    it('EFH mit Gastherme statt Wärmepumpe', () => {
        const lines = generateCalcLines(efhParams({ variants: { waermeerzeuger: 'gastherme' } }));
        expect(byKey(lines, 'gastherme').enabled).toBe(true);
        expect(byKey(lines, 'waermepumpe').enabled).toBe(false);
    });

    it('Wohnung mit ausdrücklich gewählter Gastherme', () => {
        const lines = generateCalcLines(wohnungParams({ variants: { waermeerzeuger: 'gastherme' } }));
        expect(byKey(lines, 'gastherme').enabled).toBe(true);
        expect(qty(lines, 'gastherme')).toBe(1);
    });
});

/* ─── recalcGP ─── */

describe('recalcGP – Neuberechnung nach manueller Änderung', () => {
    it('GP = Menge × EP, kaufmännisch auf Cent', () => {
        const out = recalcGP([
            { qty: 2.5, ep: 19.99 },  // 49,975 → 49,98
            { qty: 3, ep: 0.335 },    // 1,005 → 1,01
            { qty: 12, ep: 7.5 },     // 90,00
        ]);
        expect(out.map(l => l.gp)).toEqual([49.98, 1.01, 90]);
    });

    it('fehlende Menge oder fehlender EP → 0', () => {
        expect(recalcGP([{ qty: null, ep: 10 }, { qty: 5 }, {}]).map(l => l.gp)).toEqual([0, 0, 0]);
    });

    it('negative Menge (Minderung/Gutschrift) ergibt negativen GP, symmetrisch gerundet', () => {
        expect(recalcGP([{ qty: -1, ep: 50 }, { qty: -2.5, ep: 19.99 }]).map(l => l.gp)).toEqual([-50, -49.98]);
    });

    it('übernimmt alle übrigen Felder und verändert die Eingabe nicht', () => {
        const input = [{ id: 'a', trade: 'Maler', enabled: true, qty: 2, ep: 3, gp: 999 }];
        const out = recalcGP(input);
        expect(out[0]).toEqual({ id: 'a', trade: 'Maler', enabled: true, qty: 2, ep: 3, gp: 6 });
        expect(input[0].gp).toBe(999);
        expect(out[0]).not.toBe(input[0]);
    });
});
