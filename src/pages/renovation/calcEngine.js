/**
 * Sanierungsrechner – Berechnungs-Engine
 *
 * Nimmt die Wizard-Eingaben und erzeugt eine flache Liste von
 * Kalkulationszeilen (Snapshot). Keine dynamischen Abhängigkeiten.
 *
 * Jede Zeile hat:
 *   trade, subtrade, position, unit, ep (Einzelpreis), qty (Menge), gp (Gesamtpreis)
 *
 * Mengen werden über einen stabilen Schlüssel (key) je Standardposition
 * zugeordnet. Positionen ohne Schlüssel (ältere Kataloge) werden über den
 * Standardnamen erkannt – eine Umbenennung in den Einstellungen behält den
 * Schlüssel, die Menge geht dadurch nicht mehr verloren.
 */

const deg2rad = (deg) => (deg * Math.PI) / 180;

/* ─── Stabile Schlüssel der Standardpositionen (Name im Standard-Katalog → key) ─── */
export const STANDARD_POSITION_KEYS = {
    // Rückbau & Entsorgung
    'Nichttragende Innenwand abbrechen': 'abbruch_innenwand',
    'Estrich abbrechen': 'abbruch_estrich',
    'Fliesen entfernen': 'abbruch_fliesen',
    'Laminat/Vinyl/Parkett entfernen': 'abbruch_bodenbelag',
    'Türdurchbruch herstellen': 'tuerdurchbruch',
    'Tapeten entfernen': 'abbruch_tapeten',
    'Innentür ausbauen': 'innentuer_ausbauen',
    'Holzdecke demontieren': 'abbruch_holzdecke',
    'Bauschutt entsorgen': 'entsorgung_bauschutt',
    'Innentür entsorgen': 'entsorgung_innentuer',
    'Bodenbelag entsorgen': 'entsorgung_bodenbelag',
    // Rohbau
    'Stahlträger einsetzen': 'stahltraeger',
    'KS-Innenwand 11,5 cm': 'ks_innenwand',
    'Betonsturz einsetzen': 'betonsturz',
    // Dach
    'Dachstuhl erneuern': 'dachstuhl',
    'Sparren austauschen': 'sparren',
    'Gaube herstellen': 'gaube',
    'Dachziegel neu eindecken inkl. Unterspannbahn': 'dacheindeckung_ziegel',
    'Flachdachabdichtung inkl. Dämmung': 'flachdachabdichtung',
    'Dachfenster einbauen': 'dachfenster',
    'Dachrinne montieren': 'dachrinne',
    'Fallrohr montieren': 'fallrohr',
    'Attikaabdeckung': 'attika',
    'Dämmung Mineralwolle 20 cm': 'dachdaemmung',
    'Dampfbremse': 'dampfbremse',
    // Gerüst
    'Gerüst stellen Fläche (4 Wo.)': 'geruest',
    'Dachfangnetz (4 Wo.)': 'dachfangnetz',
    'Standzeit (1 Wo.)': 'geruest_standzeit',
    // Fassade
    'WDVS 16 cm': 'wdvs',
    'Fassadenputz neu': 'fassadenputz',
    'Fassadenanstrich': 'fassadenanstrich',
    // Fenster/Türen
    'Kunststofffenster 3-fach': 'fenster_kunststoff',
    'Fenster demontieren': 'fenster_demontage',
    'RAL-Montage': 'fenster_ral_montage',
    'Aluminium Haustür': 'haustuer',
    'Nebeneingangstür': 'nebeneingangstuer',
    'Fensterbänke Alu': 'fensterbank_aussen',
    'Innenfensterbänke Naturstein': 'fensterbank_innen',
    // Sanitär
    'Wasser-& Heizungsleitung verlegen': 'leitungen_wasser_heizung',
    'Abwasserleitung': 'abwasser',
    'Vorwandelement WC': 'vorwand_wc',
    'Waschmaschinenanschluss': 'waschmaschinenanschluss',
    'WC-Anlage komplett': 'wc_anlage',
    'Waschtischanlage': 'waschtisch',
    'Duschanlage komplett': 'dusche',
    'Badewanne komplett': 'badewanne',
    // Heizung
    'Luft-Wärmepumpe': 'waermepumpe',
    'Gastherme': 'gastherme',
    'Heizkörper': 'heizkoerper',
    'Fußbodenheizung': 'fussbodenheizung',
    // Elektro
    'NYM Leitung verlegen': 'elektro_leitungen',
    'Unterverteilung installieren': 'unterverteilung',
    'Zählerschrank erneuern': 'zaehlerschrank',
    'Steckdose montieren': 'steckdose',
    'Netzwerkdose montieren': 'netzwerkdose',
    'Schalter montieren': 'schalter',
    'LED Deckenspot': 'led_spot',
    'Sprechanlage': 'sprechanlage',
    // Trockenbau
    'Metallständerwand': 'staenderwand',
    'Deckenabhängung': 'deckenabhaengung',
    'Einfach beplankt Wand': 'beplankung_wand_einfach',
    'Zweifach beplankt Wand': 'beplankung_wand_zweifach',
    'Einfach beplankt Decke': 'beplankung_decke_einfach',
    'Zweifach beplankt Decke': 'beplankung_decke_zweifach',
    'Trockenestrichsystem': 'estrich_trocken',
    // Estrich
    'Zementestrich': 'estrich_zement',
    'Fließestrich': 'estrich_fliess',
    // Innenputz
    'Gipsputz': 'gipsputz',
    'Kalkzementputz': 'kalkzementputz',
    'Scheibenputz': 'scheibenputz',
    'Dämmung PUR 10cm': 'kellerdaemmung',
    // Fliesen
    'Wandfliesen verlegen': 'wandfliesen',
    'Bodenfliesen verlegen': 'bodenfliesen',
    'Sockel stellen': 'fliesensockel',
    'Abdichtung': 'abdichtung',
    'Estrich Bodengleiche Dusche': 'estrich_dusche',
    // Bodenbeläge
    'Laminat verlegen': 'laminat',
    'Vinyl verlegen': 'vinyl',
    'Parkett verlegen': 'parkett',
    'Sockelleisten MDF Weiß': 'sockelleiste',
    'Übergangsleiste': 'uebergangsleiste',
    // Maler
    'Q3 Spachtelung': 'spachtelung_q3',
    'Raufaser tapezieren': 'raufaser',
    'Malervlies tapezieren': 'malervlies',
    'Innenanstrich': 'innenanstrich',
    'Türen lackieren': 'tueren_lackieren',
    // Tischler
    'Innentür CPL': 'innentuer_cpl',
    // Metallbau
    'Balkon-Stahlkonstruktion': 'balkon_stahl',
    'WPC Balkonbelag': 'balkon_wpc',
    'Punktfundamente': 'punktfundamente',
    'Edelstahlgeländer (Stabfüllung)': 'gelaender_edelstahl',
};

const KNOWN_KEYS = new Set(Object.values(STANDARD_POSITION_KEYS));

/** Stabilen Schlüssel einer Katalogposition ermitteln (key, sonst Standardname). */
export function resolvePositionKey(pos) {
    if (pos && pos.key && KNOWN_KEYS.has(pos.key)) return pos.key;
    const name = (pos?.name || '').trim();
    return STANDARD_POSITION_KEYS[name] || null;
}

/**
 * Sich gegenseitig ausschließende Ausführungsvarianten. Je Gruppe wird nur die
 * gewählte Variante aktiviert; die übrigen Zeilen behalten ihre Menge, sind
 * aber abgewählt und lassen sich in der Kalkulation per Häkchen umschalten.
 * Auswahl über params.variants = { [gruppe]: option | 'keine' }.
 */
export const ALTERNATIVE_GROUPS = [
    {
        id: 'estrich', label: 'Estrichart', defaultOption: 'zement',
        options: { zement: ['estrich_zement'], fliess: ['estrich_fliess'], trocken: ['estrich_trocken'] },
    },
    {
        id: 'wandbelag', label: 'Wandbelag', defaultOption: 'raufaser',
        options: { raufaser: ['raufaser'], malervlies: ['malervlies'] },
    },
    {
        id: 'innentueren', label: 'Innentüren', defaultOption: 'austausch',
        options: { austausch: ['innentuer_ausbauen', 'entsorgung_innentuer', 'innentuer_cpl'], lackieren: ['tueren_lackieren'] },
    },
    {
        // Wohnung: kein Wärmeerzeuger vorausgewählt (meist Zentralheizung des Gebäudes)
        id: 'waermeerzeuger', label: 'Wärmeerzeuger', defaultOption: 'waermepumpe', defaultOptionWohnung: 'keine',
        options: { waermepumpe: ['waermepumpe'], gastherme: ['gastherme'] },
    },
    {
        id: 'heizflaechen', label: 'Heizflächen', defaultOption: 'heizkoerper',
        options: { heizkoerper: ['heizkoerper'], fussbodenheizung: ['fussbodenheizung'] },
    },
    {
        id: 'deckenbeplankung', label: 'Deckenbeplankung', defaultOption: 'einfach',
        options: { einfach: ['beplankung_decke_einfach'], zweifach: ['beplankung_decke_zweifach'] },
    },
];

// Fliesenspiegel im Bad (nicht raumhoch) in m
const FLIESENSPIEGEL_HOEHE = 1.2;
// Plausibler Bereich der Dachneigung (Grad) – verhindert explodierende Dachflächen nahe 90°
const DACHNEIGUNG_MIN = 5;
const DACHNEIGUNG_MAX = 70;
// Standzeit je Woche als Anteil der Gerüstkosten (Gerüst + Dachfangnetz)
const STANDZEIT_ANTEIL = 0.10;
// Zuschlag Wärmepumpe je weiterer Einheit im MFH (größere Anlage), Basis ist der EP der Preisliste
const WP_ZUSCHLAG_JE_WEITERE_EINHEIT = 2000;
// Rückfallpreise, falls Gerüst/Dachfangnetz in der Preisliste fehlen (Standard-Katalog)
const FALLBACK_EP = { geruest: 15, dachfangnetz: 10, waermepumpe: 20000 };

/**
 * @param {object} params
 * @param {string} params.buildingType  – 'wohnung' | 'efh' | 'mfh'
 * @param {number} params.floorHeight   – Geschosshöhe in m
 * @param {number} params.unitCount     – Anzahl Einheiten
 * @param {number} params.floorCount    – Anzahl Etagen
 * @param {string} params.roofType      – 'satteldach' | 'walmdach' | 'flachdach'
 * @param {number} params.houseWidth    – Breite (Giebelseite) in m
 * @param {number} params.houseLength   – Länge (Traufseite) in m
 * @param {number} params.roofAngle     – Dachneigung in Grad
 * @param {number} params.gaubenCount   – Anzahl Gauben
 * @param {Array}  params.floors        – Array von Etagen mit whgs[]
 * @param {Array}  params.userTrades    – Trades from user settings (with subtrades & positions)
 * @param {object} [params.variants]    – optionale Variantenwahl je Alternativgruppe (siehe ALTERNATIVE_GROUPS)
 * @returns {Array} lines – flat array of calc line objects
 */
export function generateCalcLines(params) {
    const {
        buildingType, floorHeight = 2.5, unitCount = 1, floorCount = 1,
        roofType = 'satteldach', houseWidth = 0, houseLength = 0,
        roofAngle = 35, gaubenCount = 0, floors = [], userTrades = [],
        variants = {},
    } = params;

    const isEfhMfh = buildingType === 'efh' || buildingType === 'mfh';
    const numUnits = buildingType === 'mfh' ? unitCount : 1;
    const numFloors = buildingType === 'wohnung' ? 1 : floorCount;

    // ──── Collect all rooms, baths, windows across all floors/whgs ────
    const allRooms = [];
    const allBaths = [];
    const allWindows = [];
    let whgCount = 0;

    for (const floor of floors) {
        for (const whg of (floor.whgs || [])) {
            whgCount++;
            // Negative/ungültige Maße als 0 werten – sonst ergibt √(negativ) NaN und
            // die Wandflächen ALLER Räume fielen auf 0
            for (const room of (whg.rooms || [])) {
                allRooms.push({ ...room, sqm: nonNegative(room.sqm), floorHeight });
            }
            for (const bath of (whg.bathrooms || [])) {
                allBaths.push({ ...bath, sqm: nonNegative(bath.sqm), floorHeight });
            }
            for (const win of (whg.windows || [])) {
                allWindows.push({ ...win, width: nonNegative(win.width), height: nonNegative(win.height) });
            }
        }
    }

    // ──── BASISWERTE ────
    const totalSqmRooms = allRooms.reduce((s, r) => s + (r.sqm || 0), 0);
    const totalSqmBaths = allBaths.reduce((s, b) => s + (b.sqm || 0), 0);
    const totalSqmAll = totalSqmRooms + totalSqmBaths;

    // Wandflächen (Quadrat-Umfang-Ansatz)
    const wallArea = (sqm) => 4 * Math.sqrt(sqm) * floorHeight;
    const wallAreaRooms = allRooms.reduce((s, r) => s + wallArea(r.sqm || 0), 0);
    const wallAreaBaths = allBaths.reduce((s, b) => s + wallArea(b.sqm || 0), 0);

    const ceilingAreaRooms = totalSqmRooms;
    const ceilingAreaBaths = totalSqmBaths;
    const ceilingAreaAll = ceilingAreaRooms + ceilingAreaBaths;

    // ──── BODENBELAG IST ────
    const fliesenIst = allRooms.filter(r => r.currentFlooring === 'Fliesen').reduce((s, r) => s + (r.sqm || 0), 0);
    const lplIst = allRooms.filter(r => r.currentFlooring !== 'Fliesen').reduce((s, r) => s + (r.sqm || 0), 0);

    // ──── BODENBELAG SOLL ────
    const fliesenSoll = allRooms.filter(r => r.flooring === 'Fliesen').reduce((s, r) => s + (r.sqm || 0), 0) + totalSqmBaths;
    const laminatSoll = allRooms.filter(r => r.flooring === 'Laminat').reduce((s, r) => s + (r.sqm || 0), 0);
    const vinylSoll = allRooms.filter(r => r.flooring === 'Vinyl').reduce((s, r) => s + (r.sqm || 0), 0);
    const parkettSoll = allRooms.filter(r => r.flooring === 'Parkett').reduce((s, r) => s + (r.sqm || 0), 0);

    // ──── TÜREN ────
    const isDieleFlur = (name) => {
        const n = (name || '').toLowerCase();
        return n.includes('diele') || n.includes('flur') || n.includes('korridor');
    };
    // Je Zimmer (ohne Diele/Flur) und je Bad eine Innentür
    const innerDoors = allRooms.filter(r => !isDieleFlur(r.name)).length + allBaths.length;
    const transitionStrips = innerDoors;

    // ──── FENSTER ────
    const fensterCount = allWindows.length;
    const fensterFlaeche = allWindows.reduce((s, w) => s + ((w.width || 0) / 100) * ((w.height || 0) / 100), 0);
    const fensterbankLfm = allWindows.reduce((s, w) => s + ((w.width || 0) / 100), 0);

    // ──── BÄDER FLIESEN ────
    let totalBadFliesen = 0;
    let totalBadScheibenputz = 0;
    let totalDuschCount = 0;
    let totalBadewannenCount = 0;
    let totalWaschbeckenCount = 0;
    let totalUrinalBidetCount = 0;
    let totalWaschmaschinenCount = 0;

    const spiegelHoehe = Math.min(FLIESENSPIEGEL_HOEHE, floorHeight);

    for (const bath of allBaths) {
        const sqm = bath.sqm || 0;
        const umfang = 4 * Math.sqrt(sqm);
        const fullWall = umfang * floorHeight;

        let fliesenWand = 0;

        if (bath.wallTiles === 'raumhoch') {
            // Raumhoch: komplette Wandfläche (Dusche ist enthalten)
            fliesenWand = fullWall;
        } else {
            // Fliesenspiegel 1,20 m rundum; Dusche (3 Wandseiten à 1 m) zusätzlich nur
            // oberhalb des Fliesenspiegels bis zur Decke – darunter ist sie im Umfang enthalten
            const duschWandOberhalb = bath.shower ? 3 * Math.max(0, floorHeight - spiegelHoehe) : 0;
            fliesenWand = umfang * spiegelHoehe + duschWandOberhalb;
        }

        const scheibenputz = Math.max(0, fullWall - fliesenWand);

        totalBadFliesen += fliesenWand;
        totalBadScheibenputz += scheibenputz;

        if (bath.shower) totalDuschCount++;
        if (bath.bathtub) totalBadewannenCount++;
        totalWaschbeckenCount += (bath.sinkCount || 0);
        totalUrinalBidetCount += (bath.urinalBidetCount || 0);
        if (bath.washingMachine) totalWaschmaschinenCount++;
    }

    const anzahlBaeder = allBaths.length;
    // Je Bad ein WC-Anschluss zusätzlich zu den übrigen Sanitärobjekten
    const abwasserCount = totalDuschCount + totalBadewannenCount + totalWaschbeckenCount + totalUrinalBidetCount + totalWaschmaschinenCount + anzahlBaeder;
    const vorwandWC = anzahlBaeder + totalUrinalBidetCount;

    // ──── GEBÄUDE / FASSADE / GERÜST ────
    const umfangGebaeude = 2 * houseWidth + 2 * houseLength;
    const gebaeudeHoehe = numFloors * floorHeight;
    const fassadenflaeche = umfangGebaeude * gebaeudeHoehe;

    // ──── DACH ────
    let dachflaeche = 0;
    if (isEfhMfh && houseWidth > 0 && houseLength > 0) {
        const grundflaeche = houseWidth * houseLength;
        if (roofType === 'flachdach') {
            dachflaeche = grundflaeche;
        } else {
            const rawAngle = Number(roofAngle);
            const angle = Number.isFinite(rawAngle) && rawAngle > 0
                ? Math.min(DACHNEIGUNG_MAX, Math.max(DACHNEIGUNG_MIN, rawAngle))
                : 35;
            dachflaeche = grundflaeche / Math.cos(deg2rad(angle));
        }
    }

    // Ziegeleindeckung, Dämmung und Dampfbremse nur bei geneigten Dächern
    const dachziegel = roofType !== 'flachdach' ? dachflaeche : 0;
    const daemmungMineralwolle = (roofType !== 'flachdach') ? dachflaeche : 0;
    const dampfbremse = daemmungMineralwolle;

    // Dachrinne
    let dachrinne = 0;
    if (roofType === 'satteldach') dachrinne = 2 * houseLength;
    if (roofType === 'walmdach') dachrinne = umfangGebaeude;

    const fallrohr = numFloors * floorHeight * 2;
    const attika = roofType === 'flachdach' ? umfangGebaeude : 0;

    // Dachfangnetz
    let dachfangnetz = 0;
    if (roofType === 'satteldach') dachfangnetz = 2 * houseWidth;
    if (roofType === 'walmdach' || roofType === 'flachdach') dachfangnetz = umfangGebaeude;

    // Sockel (Fliesensockel) für Räume, die künftig Fliesen erhalten (SOLL)
    const sockelFliesenLfm = allRooms
        .filter(r => r.flooring === 'Fliesen')
        .reduce((s, r) => s + 4 * Math.sqrt(r.sqm || 0), 0);
    // Sockelleisten für Vinyl/Laminat/Parkett SOLL
    const sockelleistenLfm = allRooms
        .filter(r => r.flooring === 'Vinyl' || r.flooring === 'Laminat' || r.flooring === 'Parkett')
        .reduce((s, r) => s + 4 * Math.sqrt(r.sqm || 0), 0);

    // Anzahl Zimmer und Bäder
    const numRooms = allRooms.length;
    const numBaths = allBaths.length;

    // Bauschutt m³
    // NichttragendInnenwand default 0, Estrich=totalSqmAll, FliesenEntfernen=fliesenIst
    const bauschuttM3 = round2((0 * 0.3) + (totalSqmAll * 0.1) + (fliesenIst * 0.03));

    // EG-Fläche (Erdgeschoss = floors[0]) für Kellerdämmung
    let egFlaeche = 0;
    const egFloor = floors[0];
    if (egFloor) {
        for (const whg of (egFloor.whgs || [])) {
            for (const room of (whg.rooms || [])) egFlaeche += nonNegative(room.sqm);
            for (const bath of (whg.bathrooms || [])) egFlaeche += nonNegative(bath.sqm);
        }
    }

    // Abdichtung Bad = Badfläche + je Dusche 3 * Geschosshöhe
    const abdichtung = totalSqmBaths + (totalDuschCount * 3 * floorHeight);

    // Gebäudebezogene Mengen (Dach, Fassade, Haustür, Heizzentrale, Keller …) nur bei EFH/MFH
    const building = (v) => (isEfhMfh ? v : 0);

    // ──── BUILD LINES ────
    // Map: stabiler Positionsschlüssel → qty
    const qtyMap = {
        // Rückbau & Entsorgung
        abbruch_innenwand: 0,
        abbruch_estrich: round2(totalSqmAll),
        abbruch_fliesen: round2(fliesenIst),
        abbruch_bodenbelag: round2(lplIst),
        tuerdurchbruch: 0,
        abbruch_tapeten: round2(wallAreaRooms + wallAreaBaths + ceilingAreaAll),
        innentuer_ausbauen: innerDoors,
        abbruch_holzdecke: round2(ceilingAreaAll),
        entsorgung_bauschutt: round2(bauschuttM3),
        entsorgung_innentuer: innerDoors,
        entsorgung_bodenbelag: round2(lplIst),

        // Rohbau
        stahltraeger: 0,
        ks_innenwand: 0,
        betonsturz: 0,

        // Dach
        dachstuhl: round2(dachflaeche),
        sparren: 0,
        gaube: building(gaubenCount),
        dacheindeckung_ziegel: round2(dachziegel),
        flachdachabdichtung: roofType === 'flachdach' ? round2(dachflaeche) : 0,
        dachfenster: 0,
        dachrinne: round2(building(dachrinne)),
        fallrohr: round2(building(fallrohr)),
        attika: round2(building(attika)),
        dachdaemmung: round2(daemmungMineralwolle),
        dampfbremse: round2(dampfbremse),

        // Gerüst
        geruest: round2(building(fassadenflaeche)),
        dachfangnetz: round2(building(dachfangnetz)),
        geruest_standzeit: isEfhMfh ? 1 : 0, // Psch., EP wird aus Gerüst-/Fangnetzkosten berechnet

        // Fassade
        wdvs: round2(building(fassadenflaeche)),
        fassadenputz: round2(building(fassadenflaeche)),
        fassadenanstrich: round2(building(fassadenflaeche)),

        // Fenster/Türen
        fenster_kunststoff: round2(fensterFlaeche),
        fenster_demontage: fensterCount,
        fenster_ral_montage: fensterCount,
        haustuer: building(1),
        nebeneingangstuer: 0,
        fensterbank_aussen: round2(fensterbankLfm),
        fensterbank_innen: round2(fensterbankLfm),

        // Sanitär
        leitungen_wasser_heizung: round2(totalSqmAll),
        abwasser: abwasserCount,
        vorwand_wc: vorwandWC,
        waschmaschinenanschluss: totalWaschmaschinenCount,
        wc_anlage: vorwandWC,
        waschtisch: totalWaschbeckenCount,
        dusche: totalDuschCount,
        badewanne: totalBadewannenCount,

        // Heizung
        waermepumpe: building(1),
        gastherme: numUnits,
        heizkoerper: numRooms + numBaths,
        fussbodenheizung: round2(totalSqmAll),

        // Elektro
        elektro_leitungen: round2(totalSqmAll),
        unterverteilung: numUnits,
        zaehlerschrank: numUnits,
        steckdose: (numRooms + numBaths) * 4,
        netzwerkdose: whgCount * 2,
        schalter: numRooms + numBaths + numFloors,
        led_spot: (numRooms + numBaths) * 4,
        sprechanlage: numUnits,

        // Trockenbau
        staenderwand: 0,
        deckenabhaengung: round2(ceilingAreaAll),
        beplankung_wand_einfach: 0,
        beplankung_wand_zweifach: 0,
        beplankung_decke_einfach: round2(ceilingAreaAll),
        beplankung_decke_zweifach: round2(ceilingAreaAll),
        estrich_trocken: round2(totalSqmAll),

        // Estrich
        estrich_zement: round2(totalSqmAll),
        estrich_fliess: round2(totalSqmAll),

        // Innenputz
        gipsputz: round2(wallAreaRooms),
        kalkzementputz: round2(wallAreaBaths),
        // Pauschal 50 m² je Etage (Gebäude/Treppenhaus) nur bei EFH/MFH, dazu Bad-Wandflächen über den Fliesen
        scheibenputz: round2(building(50 * numFloors) + totalBadScheibenputz),
        kellerdaemmung: round2(building(egFlaeche)),

        // Fliesen
        wandfliesen: round2(totalBadFliesen),
        bodenfliesen: round2(fliesenSoll),
        fliesensockel: round2(sockelFliesenLfm),
        abdichtung: round2(abdichtung),
        estrich_dusche: totalDuschCount,

        // Bodenbeläge
        laminat: round2(laminatSoll),
        vinyl: round2(vinylSoll),
        parkett: round2(parkettSoll),
        sockelleiste: round2(sockelleistenLfm),
        uebergangsleiste: transitionStrips,

        // Maler
        spachtelung_q3: round2(wallAreaRooms + ceilingAreaRooms + ceilingAreaBaths),
        raufaser: round2(wallAreaRooms),
        malervlies: round2(wallAreaRooms),
        innenanstrich: round2(wallAreaRooms),
        tueren_lackieren: innerDoors,

        // Tischler
        innentuer_cpl: innerDoors,

        // Metallbau
        balkon_stahl: 0,
        balkon_wpc: 0,
        punktfundamente: 0,
        gelaender_edelstahl: 0,
    };

    // ──── Preise aus der Preisliste des Nutzers (je Schlüssel, erste Fundstelle) ────
    const userPriceByKey = {};
    for (const trade of userTrades) {
        for (const sub of (trade.subtrades || [])) {
            for (const pos of (sub.positions || [])) {
                const key = resolvePositionKey(pos);
                const price = Number(pos.price);
                if (key && !(key in userPriceByKey) && Number.isFinite(price)) userPriceByKey[key] = price;
            }
        }
    }
    const userPrice = (key) => (key in userPriceByKey ? userPriceByKey[key] : FALLBACK_EP[key]);

    // EP overrides (berechnete Preise auf Basis der Nutzerpreise)
    const epOverrides = {};
    if (isEfhMfh) {
        // Standzeit je Woche: Anteil der Gerüstkosten, berechnet mit den EP der Preisliste
        const geruestKosten = fassadenflaeche * (userPrice('geruest') || 0) + dachfangnetz * (userPrice('dachfangnetz') || 0);
        epOverrides.geruest_standzeit = round2(geruestKosten * STANDZEIT_ANTEIL);
    }
    // Wärmepumpe: EP der Preisliste (Rückfall Standardpreis nur ohne gültigen Preis) + Zuschlag je
    // weiterer Einheit im MFH. Ein bewusst auf 0 gesetzter Preis bleibt 0 (kein Zuschlag, kein Ersatzwert).
    const wpBasis = userPrice('waermepumpe');
    epOverrides.waermepumpe = wpBasis > 0 ? wpBasis + Math.max(0, numUnits - 1) * WP_ZUSCHLAG_JE_WEITERE_EINHEIT : 0;

    // ──── Alternativgruppen: nur die gewählte Variante aktiv ────
    const disabledKeys = new Set();
    const groupOfKey = {};
    for (const group of ALTERNATIVE_GROUPS) {
        const defaultOption = (!isEfhMfh && group.defaultOptionWohnung) ? group.defaultOptionWohnung : group.defaultOption;
        const requested = variants ? variants[group.id] : undefined;
        const chosen = (requested === 'keine' || (requested && group.options[requested])) ? requested : defaultOption;
        for (const [option, keys] of Object.entries(group.options)) {
            for (const key of keys) {
                groupOfKey[key] = group.id;
                if (option !== chosen) disabledKeys.add(key);
            }
        }
    }

    // ──── Build flat line items from user trades ────
    const lines = [];

    for (const trade of userTrades) {
        for (const sub of (trade.subtrades || [])) {
            const positions = sub.positions || [];
            for (const pos of positions) {
                const posName = pos.name;
                const key = resolvePositionKey(pos);
                const qty = key && qtyMap[key] !== undefined ? qtyMap[key] : 0;
                const ep = key && epOverrides[key] !== undefined ? epOverrides[key] : (pos.price || 0);
                const gp = round2(qty * ep);

                lines.push({
                    id: pos.id || `${trade.name}_${sub.name}_${posName}`.replace(/\s/g, '_'),
                    key: key || null,
                    trade: trade.name,
                    subtrade: sub.name,
                    position: posName,
                    unit: pos.unit || 'Stk.',
                    ep,
                    qty,
                    gp,
                    enabled: qty > 0 && !(key && disabledKeys.has(key)),
                    ...(key && groupOfKey[key] ? { alternativeGroup: groupOfKey[key] } : {}),
                });
            }
        }
    }

    return lines;
}

/**
 * Kaufmännisch auf 2 Nachkommastellen runden (…5 → weg von 0).
 * Gleitkomma-Rauschen wird vorher entfernt (z. B. 2,5 × 19,99 = 49,974999… → 49,98 statt 49,97).
 */
function round2(v) {
    const n = Number(v) || 0;
    const cents = Math.round(Number((Math.abs(n) * 100).toPrecision(15)));
    return (Math.sign(n) * cents) / 100 || 0;
}

/** Fläche/Maß als nicht-negative Zahl (leer, ungültig oder negativ → 0). */
function nonNegative(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Recalculate GP for all lines (used after manual qty/ep edit)
 */
export function recalcGP(lines) {
    return lines.map(l => ({
        ...l,
        gp: round2((l.qty || 0) * (l.ep || 0)),
    }));
}
