$ErrorActionPreference = "Stop"

Write-Host "Starte Deployment-Vorbereitung für Marketing Website..." -ForegroundColor Cyan

# 1. Bauen der Anwendung
Write-Host "Installiere Abhängigkeiten und baue Anwendung (npm run build)..." -ForegroundColor Cyan
npm install
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build fehlgeschlagen!" -ForegroundColor Red
    exit 1
}

# 2. Prüfen ob Git initialisiert ist
if (-not (Test-Path ".git")) {
    Write-Host "Initialisiere Git für Marketing Website..." -ForegroundColor Cyan
    git init
    git config windows.appendAtomically false
    git config user.name "ImmoControl Admin"
    git config user.email "admin@immocontrol360.de"
    git remote add origin https://github.com/jxxx87/immocontrol360.git
}

# Ensure correct branch
git checkout -B landing-master 2>$null

# Dummy package.json in dist erstellen, um Hostinger-Prüfung zu bestehen
$dummyPkg = '{"name": "immocontrol360-landing", "version": "1.0.0", "scripts": {"build": "echo ''No build needed''"}}'
Set-Content -Path "dist\package.json" -Value $dummyPkg

# Cleanup local temporary branch if it exists
git branch -D production-landing-local 2>$null

# Dist Ordner temporär committen (ist normalerweise in .gitignore)
git add dist -f
git commit -m "Deploy Marketing Build Artifacts (With Dummy package.json)"

# Split Dist-Ordner in lokalen Branch und force-pushe diesen
Write-Host "Erstelle lokalen Deployment-Branch..." -ForegroundColor Cyan
git subtree split --prefix dist -b production-landing-local

Write-Host "Pushe 'dist' Ordner in den 'production-landing' Branch (Force)..." -ForegroundColor Cyan
git push origin production-landing-local:production-landing --force

# Aufräumen: Den temporären Branch und Commit wieder entfernen
git branch -D production-landing-local
git reset HEAD~1

Write-Host "--------------------------------------------------------" -ForegroundColor Green
Write-Host "Marketing-Deployment erfolgreich vorbereitet!" -ForegroundColor Green
Write-Host "Gehe nun zu Hostinger -> Git (für Hauptdomain immocontrol360.de):" -ForegroundColor White
Write-Host "1. Repository URL eingeben: https://github.com/jxxx87/immocontrol360.git"
Write-Host "2. Branch 'production-landing' auswählen."
Write-Host "3. Install Directory leer lassen (oder /public_html)."
Write-Host "--------------------------------------------------------"
