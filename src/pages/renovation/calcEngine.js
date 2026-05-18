/**
 * Sanierungsrechner – Berechnungs-Engine
 *
 * Nimmt die Wizard-Eingaben und erzeugt eine flache Liste von
 * Kalkulationszeilen (Snapshot). Keine dynamischen Abhängigkeiten.
 *
 * Jede Zeile hat:
 *   trade, subtrade, position, unit, ep (Einzelpreis), qty (Menge), gp (Gesamtpreis)
 */

const deg2rad = (deg) => (deg * Math.PI) / 180;

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
 * @returns {Array} lines – flat array of calc line objects
 */
export function generateCalcLines(params) {
    const {
        buildingType, floorHeight = 2.5, unitCount = 1, floorCount = 1,
        roofType = 'satteldach', houseWidth = 0, houseLength = 0,
        roofAngle = 35, gaubenCount = 0, floors = [], userTrades = [],
    } = params;

    const isEfhMfh = buildingType === 'efh' || buildingType === 'mfh';
    const numUnits = buildingType === 'mfh' ? unitCount : 1;
    const numFloors = buildingType === 'wohnung' ? 1 : floorCount;

    // ──── Collect all rooms, baths, windows across all floors/whgs ────
    const allRooms = [];
    const allBaths = [];
    const allWindows = [];
    let whgCount = 0;
    let balconyCount = 0;

    for (const floor of floors) {
        for (const whg of (floor.whgs || [])) {
            whgCount++;
            if (whg.balcony) balconyCount++;
            for (const room of (whg.rooms || [])) {
                allRooms.push({ ...room, floorHeight });
            }
            for (const bath of (whg.bathrooms || [])) {
                allBaths.push({ ...bath, floorHeight });
            }
            for (const win of (whg.windows || [])) {
                allWindows.push(win);
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
    const innerDoors = allRooms.filter(r => !isDieleFlur(r.name)).length;
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

    for (const bath of allBaths) {
        const sqm = bath.sqm || 0;
        const umfang = 4 * Math.sqrt(sqm);
        const fullWall = umfang * floorHeight;

        let fliesenWand = 0;
        const duschWand = bath.shower ? 3 * floorHeight : 0; // 3 Seiten * Geschosshöhe

        if (bath.wallTiles === 'raumhoch') {
            // Raumhoch: komplette Wandfläche + Dusche
            fliesenWand = fullWall;
        } else {
            // 1,30m Spiegel → 1,2m rundum + Dusche raumhoch
            fliesenWand = umfang * 1.2 + duschWand;
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
    const abwasserCount = totalDuschCount + totalBadewannenCount + totalWaschbeckenCount + totalUrinalBidetCount + totalWaschmaschinenCount + 1;
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
            const cosAngle = Math.cos(deg2rad(roofAngle || 35));
            dachflaeche = cosAngle > 0 ? grundflaeche / cosAngle : grundflaeche;
        }
    }

    const dachziegel = dachflaeche;
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

    // Standzeit: 10% von (Gerüst + Dachfangnetz Kosten)
    const geruestKosten = fassadenflaeche * 15 + dachfangnetz * 10;
    const standzeitKosten = round2(geruestKosten * 0.10);

    // Sockel IST Fliesen
    const sockelFliesenLfm = allRooms
        .filter(r => r.currentFlooring === 'Fliesen')
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
            for (const room of (whg.rooms || [])) egFlaeche += (room.sqm || 0);
            for (const bath of (whg.bathrooms || [])) egFlaeche += (bath.sqm || 0);
        }
    }

    // Abdichtung Bad = Badfläche + je Dusche 3 * Geschosshöhe
    const abdichtung = totalSqmBaths + (totalDuschCount * 3 * floorHeight);

    // ──── BUILD LINES ────
    // Map: positionName → qty
    const qtyMap = {
        // Rückbau & Entsorgung
        'Nichttragende Innenwand abbrechen': 0,
        'Estrich abbrechen': round2(totalSqmAll),
        'Fliesen entfernen': round2(fliesenIst),
        'Laminat/Vinyl/Parkett entfernen': round2(lplIst),
        'Türdurchbruch herstellen': 0,
        'Tapeten entfernen': round2(wallAreaRooms + wallAreaBaths + ceilingAreaAll),
        'Innentür ausbauen': innerDoors,
        'Holzdecke demontieren': round2(ceilingAreaAll),
        'Bauschutt entsorgen': round2(bauschuttM3),
        'Innentür entsorgen': innerDoors,
        'Bodenbelag entsorgen': round2(lplIst),

        // Rohbau
        'Stahlträger einsetzen': 0,
        'KS-Innenwand 11,5 cm': 0,
        'Betonsturz einsetzen': 0,

        // Dach
        'Dachstuhl erneuern': round2(dachflaeche),
        'Sparren austauschen': 0,
        'Gaube herstellen': gaubenCount,
        'Dachziegel neu eindecken inkl. Unterspannbahn': round2(dachziegel),
        'Flachdachabdichtung inkl. Dämmung': roofType === 'flachdach' ? round2(dachflaeche) : 0,
        'Dachfenster einbauen': 0,
        'Dachrinne montieren': round2(dachrinne),
        'Fallrohr montieren': round2(fallrohr),
        'Attikaabdeckung': round2(attika),
        'Dämmung Mineralwolle 20 cm': round2(daemmungMineralwolle),
        'Dampfbremse': round2(dampfbremse),

        // Gerüst
        'Gerüst stellen Fläche (4 Wo.)': round2(isEfhMfh ? fassadenflaeche : 0),
        'Dachfangnetz (4 Wo.)': round2(isEfhMfh ? dachfangnetz : 0),
        'Standzeit (1 Wo.)': isEfhMfh ? 1 : 0, // Psch., EP wird durch standzeitKosten ersetzt

        // Fassade
        'WDVS 16 cm': round2(isEfhMfh ? fassadenflaeche : 0),
        'Fassadenputz neu': round2(isEfhMfh ? fassadenflaeche : 0),
        'Fassadenanstrich': round2(isEfhMfh ? fassadenflaeche : 0),

        // Fenster/Türen
        'Kunststofffenster 3-fach': round2(fensterFlaeche),
        'Fenster demontieren': fensterCount,
        'RAL-Montage': fensterCount,
        'Aluminium Haustür': 1,
        'Nebeneingangstür': 0,
        'Fensterbänke Alu': round2(fensterbankLfm),
        'Innenfensterbänke Naturstein': round2(fensterbankLfm),

        // Sanitär
        'Wasser-& Heizungsleitung verlegen': round2(totalSqmAll),
        'Abwasserleitung': abwasserCount,
        'Vorwandelement WC': vorwandWC,
        'Waschmaschinenanschluss': totalWaschmaschinenCount,
        'WC-Anlage komplett': vorwandWC,
        'Waschtischanlage': totalWaschbeckenCount,
        'Duschanlage komplett': totalDuschCount,
        'Badewanne komplett': totalBadewannenCount,

        // Heizung
        'Luft-Wärmepumpe': 1,
        'Gastherme': numUnits,
        'Heizkörper': numRooms + numBaths,
        'Fußbodenheizung': round2(totalSqmAll),

        // Elektro
        'NYM Leitung verlegen': round2(totalSqmAll),
        'Unterverteilung installieren': numUnits,
        'Zählerschrank erneuern': numUnits,
        'Steckdose montieren': (numRooms + numBaths) * 4,
        'Netzwerkdose montieren': whgCount * 2,
        'Schalter montieren': numRooms + numBaths + numFloors,
        'LED Deckenspot': (numRooms + numBaths) * 4,
        'Sprechanlage': numUnits,

        // Trockenbau
        'Metallständerwand': 0,
        'Deckenabhängung': round2(ceilingAreaAll),
        'Einfach beplankt Wand': 0,
        'Zweifach beplankt Wand': 0,
        'Einfach beplankt Decke': round2(ceilingAreaAll),
        'Zweifach beplankt Decke': round2(ceilingAreaAll),
        'Trockenestrichsystem': round2(totalSqmAll),

        // Estrich
        'Zementestrich': round2(totalSqmAll),
        'Fließestrich': round2(totalSqmAll),

        // Innenputz
        'Gipsputz': round2(wallAreaRooms),
        'Kalkzementputz': round2(wallAreaBaths),
        'Scheibenputz': round2((50 * numFloors) + totalBadScheibenputz),
        'Dämmung PUR 10cm': round2(egFlaeche),

        // Fliesen
        'Wandfliesen verlegen': round2(totalBadFliesen),
        'Bodenfliesen verlegen': round2(fliesenSoll),
        'Sockel stellen': round2(sockelFliesenLfm),
        'Abdichtung': round2(abdichtung),
        'Estrich Bodengleiche Dusche': totalDuschCount,

        // Bodenbeläge
        'Laminat verlegen': round2(laminatSoll),
        'Vinyl verlegen': round2(vinylSoll),
        'Parkett verlegen': round2(parkettSoll),
        'Sockelleisten MDF Weiß': round2(sockelleistenLfm),
        'Übergangsleiste': transitionStrips,

        // Maler
        'Q3 Spachtelung': round2(wallAreaRooms + ceilingAreaRooms + ceilingAreaBaths),
        'Raufaser tapezieren': round2(wallAreaRooms),
        'Malervlies tapezieren': round2(wallAreaRooms),
        'Innenanstrich': round2(wallAreaRooms),
        'Türen lackieren': innerDoors,

        // Tischler
        'Innentür CPL': innerDoors,

        // Metallbau
        'Balkon-Stahlkonstruktion': 0,
        'WPC Balkonbelag': 0,
        'Punktfundamente': 0,
        'Edelstahlgeländer (Stabfüllung)': 0,
    };

    // EP overrides (dynamic prices)
    const epOverrides = {
        'Luft-Wärmepumpe': 20000 + (numUnits * 2000),
    };
    if (isEfhMfh) {
        epOverrides['Standzeit (1 Wo.)'] = standzeitKosten; // overwrite EP with calculated cost
    }

    // ──── Build flat line items from user trades ────
    const lines = [];

    for (const trade of userTrades) {
        for (const sub of (trade.subtrades || [])) {
            const positions = sub.positions || [];
            for (const pos of positions) {
                const posName = pos.name;
                const qty = qtyMap[posName] !== undefined ? qtyMap[posName] : 0;
                const ep = epOverrides[posName] !== undefined ? epOverrides[posName] : (pos.price || 0);
                const gp = round2(qty * ep);

                lines.push({
                    id: pos.id || `${trade.name}_${sub.name}_${posName}`.replace(/\s/g, '_'),
                    trade: trade.name,
                    subtrade: sub.name,
                    position: posName,
                    unit: pos.unit || 'Stk.',
                    ep,
                    qty,
                    gp,
                    enabled: qty > 0,
                });
            }
        }
    }

    return lines;
}

function round2(v) {
    return Math.round((v || 0) * 100) / 100;
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
