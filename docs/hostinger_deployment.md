# Hostinger Deployment Guide für ImmoControlpro360

Dieses Dokument hält die Besonderheiten und Workarounds fest, die für ein erfolgreiches automatisches Deployment dieses React 19 / Vite Projekts auf Hostinger via GitHub notwendig sind.

## 1. Ordnerstruktur und Root-Verzeichnis
Das Git-Repository liegt im Ordner `immo-web`. Das bedeutet, für Hostinger ist das Root-Verzeichnis (Stammverzeichnis) `./` exakt der Ordner `immo-web`, in dem sich auch die `package.json` befindet.
* **Hostinger Einstellung "Root-Verzeichnis":** Muss auf `./` bleiben.

## 2. Peer-Dependency-Konflikte (React 19)
Da wir **React 19** verwenden, einige Bibliotheken (insbesondere `@react-three/fiber` und `@react-three/drei` für den 3D-Grundriss) aber noch strikte Peer-Dependencies für React 18 haben, würde ein normales `npm install` auf Hostinger sofort mit einem `ERESOLVE`-Fehler abbrechen.
* **Die Lösung:** Es existiert eine `.npmrc`-Datei im Root-Verzeichnis (`immo-web/.npmrc`) mit dem Inhalt `legacy-peer-deps=true`. Dadurch ignoriert Hostinger (und npm) diese Versionskonflikte und der Build bricht nicht nach 3 Sekunden ab.

## 3. Die "react-is" Abhängigkeit bei Recharts
Die Diagramm-Bibliothek `recharts` nutzt intern ein Hilfsmodul namens `react-is`. Bei manchen Node/npm-Versionen auf Hostinger wird dieses Modul bei Nutzung von `legacy-peer-deps` nicht automatisch tief mitinstalliert, was beim Rollup/Vite-Build zu folgendem Fehler führt:
> `[vite]: Rollup failed to resolve import "react-is" from ".../recharts/es6/util/ReactUtils.js"`
* **Die Lösung:** `react-is` wurde explizit als direkte Abhängigkeit (`dependency`) in unsere `package.json` aufgenommen. Dadurch wird es zwingend installiert und der Vite-Build läuft fehlerfrei durch.

## 4. Zusammenfassung für künftige Änderungen
Wenn in Zukunft ähnliche Abstürze beim automatischen Deployment ("Build failed in 3s") auftreten:
1. **Logs prüfen:** In Hostinger auf "Protokolle: Anzeigen" klicken.
2. **Fehlendes Paket?** Wenn Rollup ein Paket nicht auflösen kann, dieses einfach mit `npm install <paketname>` fest in die `package.json` schreiben.
3. **npm install scheitert?** Sicherstellen, dass die `.npmrc` Datei vorhanden ist und `legacy-peer-deps=true` enthält.
4. **Kein temporärer Branch mehr:** Der Umweg über `git subtree split` und einen `production`-Branch ist nicht mehr nötig. Hostinger baut den `master`-Zweig nun erfolgreich selbst.
