$ErrorActionPreference = "Stop"

Write-Host "Starte Deployment-Vorbereitung für Hostinger..." -ForegroundColor Cyan

# 1. Prüfen ob Remote Origin existiert
$remotes = git remote
if ($remotes -notcontains "origin") {
    Write-Host "FEHLER: Kein Remote-Repository 'origin' gefunden." -ForegroundColor Red
    Write-Host "Bitte füge zuerst ein Remote-Repository hinzu:" -ForegroundColor Yellow
    Write-Host "  git remote add origin <DEINE_REPO_URL>"
    exit 1
}

# 2. Bauen der Anwendung
Write-Host "Baue Anwendung (npm run build)..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build fehlgeschlagen!" -ForegroundColor Red
    exit 1
}

# 3. Source-Code auf Main pushen
Write-Host "Pushe Source-Code auf 'main'..." -ForegroundColor Cyan
git push origin master
if ($LASTEXITCODE -ne 0) {
    Write-Host "Konnte nicht auf master pushen. Prüfe deine Git-Einstellungen." -ForegroundColor Red
}

# 4. Deployment Branch 'production' erstellen/aktualisieren
Write-Host "Bereite 'production' Branch vor..." -ForegroundColor Cyan

# Dist ordner temporär committen (ist normalerweise ignoriert)
git add dist -f
git commit -m "Deploy Build Artifacts"

# Subtree Push: Schiebt den Inhalt von 'dist' in das Root-Verzeichnis des 'production' Branches
Write-Host "Pushe 'dist' Ordner in den 'production' Branch..." -ForegroundColor Cyan
git subtree push --prefix dist origin production

# Aufräumen: Den temporären Commit wieder entfernen
git reset HEAD~1

Write-Host "--------------------------------------------------------" -ForegroundColor Green
Write-Host "Deployment erfolgreich vorbereitet!" -ForegroundColor Green
Write-Host "Gehe nun zu Hostinger -> Git:" -ForegroundColor White
Write-Host "1. Repository URL eingeben."
Write-Host "2. Branch 'production' auswählen (nicht master/main!)."
Write-Host "3. Install Directory leer lassen (oder public_html)."
Write-Host "--------------------------------------------------------"
