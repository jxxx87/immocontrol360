// Verkleinerte WebP-Fassungen der Bilder in public/images (Komplett-Check 2026-11-27, W1b-10).
// Die PNG-Originale bleiben liegen: als Rückfall für Browser ohne WebP, für Verweise per Pfad
// (z. B. data/featureData.js) und für og:image in index.html.
// Erzeugt mit Pillow (WebP, Qualität 82, Logo 90). Wird ein Screenshot ersetzt, die WebP-Dateien neu
// erzeugen und Maße/Breiten unten anpassen. Dateinamen NICHT nach dem Muster "name-XXXXXXXX.webp"
// (8 Zeichen nach einem Bindestrich) benennen – sonst greift die immutable-Cache-Regel in public/.htaccess.
const IMAGES = {
    '/images/w_Dashboard.png': { width: 2385, height: 1377, webp: [['/images/w_Dashboard_800.webp', 800], ['/images/w_Dashboard_1600.webp', 1600]] },
    '/images/W_BuyandHold.png': { width: 2380, height: 1374, webp: [['/images/W_BuyandHold_800.webp', 800], ['/images/W_BuyandHold_1600.webp', 1600]] },
    '/images/w_FixandFlip.png': { width: 2379, height: 1372, webp: [['/images/w_FixandFlip_800.webp', 800], ['/images/w_FixandFlip_1600.webp', 1600]] },
    '/images/w-Ticketboard.png': { width: 2397, height: 1222, webp: [['/images/w-Ticketboard_800.webp', 800], ['/images/w-Ticketboard_1600.webp', 1600]] },
    '/images/w-MieterDashboard.png': { width: 565, height: 1282, webp: [['/images/w-MieterDashboard.webp', 565]] },
    '/images/w_Nachrichten.png': { width: 568, height: 1287, webp: [['/images/w_Nachrichten.webp', 568]] },
    '/images/w_Ticketerstellen.png': { width: 571, height: 1278, webp: [['/images/w_Ticketerstellen.webp', 571]] },
    // Logo: 80 px hoch (angezeigt mit 40 px, also scharf bei doppelter Pixeldichte); auch der PNG-Rückfall ist verkleinert
    '/images/logo.png': { width: 329, height: 80, fallback: '/images/logo_80.png', webp: [['/images/logo_80.webp', 329]] },
};

// Liefert für einen Bildpfad die WebP-Quelle(n), den Rückfall und die Seitenverhältnis-Angaben –
// oder null, wenn es keine Varianten gibt (dann wird das Bild unverändert angezeigt).
export const getImageVariants = (src) => {
    const entry = IMAGES[src];
    if (!entry) return null;
    const multiple = entry.webp.length > 1;
    return {
        width: entry.width,
        height: entry.height,
        fallback: entry.fallback || src,
        // Mehrere Breiten: Auswahl über srcset + sizes; eine Breite: einfache Quelle
        srcSet: multiple ? entry.webp.map(([url, w]) => `${url} ${w}w`).join(', ') : entry.webp[0][0],
        usesSizes: multiple,
    };
};
