$ErrorActionPreference = "Stop"

Write-Host "Starte kombiniertes Deployment (Marketing Website + Web-App)..." -ForegroundColor Cyan

# 1. Marketing-Website bauen
Write-Host "Baue Marketing-Website..." -ForegroundColor Cyan
Push-Location "..\immowebsite"
npm run build
Pop-Location

# 2. Web-App bauen
Write-Host "Baue Web-App..." -ForegroundColor Cyan
npm run build

# 3. Temporäres Deployment-Verzeichnis vorbereiten
Write-Host "Bereite Deployment-Ordner vor..." -ForegroundColor Cyan
$tempDir = "temp_deploy"
if (Test-Path $tempDir) {
    Remove-Item -Path $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir > $null
New-Item -ItemType Directory -Path "$tempDir\app" > $null

# 4. Dateien kopieren
Write-Host "Kopiere Marketingpage-Dateien (in Root)..." -ForegroundColor Cyan
Copy-Item -Path "..\immowebsite\dist\*" -Destination $tempDir -Recurse -Force

Write-Host "Kopiere Web-App-Dateien (in /app)..." -ForegroundColor Cyan
Copy-Item -Path "dist\*" -Destination "$tempDir\app" -Recurse -Force

# 5. Dummy package.json im Root erstellen, um Hostinger-Prüfung zu bestehen
Write-Host "Erstelle Hostinger-Dummy-package.json..." -ForegroundColor Cyan
$dummyPkg = '{"name": "immocontrol360-combined", "version": "1.0.0", "scripts": {"build": "echo ''No build needed''"}}'
Set-Content -Path "$tempDir\package.json" -Value $dummyPkg

# 6. Git initialisieren und pushen
Write-Host "Pushe kombiniertes Build in den 'production'-Branch..." -ForegroundColor Cyan
Push-Location $tempDir

git init
git config windows.appendAtomically false
git config user.name "ImmoControl Admin"
git config user.email "admin@immocontrol360.de"
git remote add origin https://github.com/jxxx87/immocontrol360.git
git checkout -B production

git add .
git commit -m "Deploy Combined Build Artifacts"
git push origin production --force

Pop-Location

# 7. Aufräumen
Write-Host "Bereinige temporäre Dateien..." -ForegroundColor Cyan
Remove-Item -Path $tempDir -Recurse -Force

Write-Host "--------------------------------------------------------" -ForegroundColor Green
Write-Host "Kombiniertes Deployment erfolgreich hochgeladen!" -ForegroundColor Green
Write-Host "Gehe nun zu Hostinger -> Git (für Hauptdomain immocontrol360.de):" -ForegroundColor White
Write-Host "1. Repository: https://github.com/jxxx87/immocontrol360.git"
Write-Host "2. Zweig (Branch): production"
Write-Host "3. Framework-Voreinstellung: Other"
Write-Host "4. Build-Befehl: npm run build"
Write-Host "5. Ausgabeverzeichnis: ."
Write-Host "--------------------------------------------------------"
