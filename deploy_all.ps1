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

# 3. Temporäres Deployment-Verzeichnis vorbereiten (Klonen für inkrementellen Push)
Write-Host "Bereite Deployment-Ordner vor (Klonen von production)..." -ForegroundColor Cyan
$tempDir = "temp_deploy"
if (Test-Path $tempDir) {
    Remove-Item -Path $tempDir -Recurse -Force
}

# Klonen nur des production-Branches (flach), um die Git-Historie zu erhalten
git clone --branch production --depth 1 https://github.com/jxxx87/immocontrol360.git $tempDir
if ($LASTEXITCODE -ne 0) {
    Write-Host "Klonen fehlgeschlagen. Initialisiere leeres Repository..." -ForegroundColor Yellow
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $tempDir > $null
    Push-Location $tempDir
    git init
    git remote add origin https://github.com/jxxx87/immocontrol360.git
    git checkout -B production
    Pop-Location
} else {
    # Alle vorhandenen Dateien löschen, außer dem .git-Ordner
    Push-Location $tempDir
    Get-ChildItem -Exclude .git | Remove-Item -Recurse -Force
    Pop-Location
}

# 4. Dateien kopieren
New-Item -ItemType Directory -Path "$tempDir\app" > $null

Write-Host "Kopiere Marketingpage-Dateien (in Root)..." -ForegroundColor Cyan
Copy-Item -Path "..\immowebsite\dist\*" -Destination $tempDir -Recurse -Force

Write-Host "Kopiere Web-App-Dateien (in /app)..." -ForegroundColor Cyan
Copy-Item -Path "dist\*" -Destination "$tempDir\app" -Recurse -Force

# 5. Dummy package.json im Root erstellen, um Hostinger-Prüfung zu bestehen
Write-Host "Erstelle Hostinger-Dummy-package.json..." -ForegroundColor Cyan
$dummyPkg = '{"name": "immocontrol360-combined", "version": "1.0.0", "scripts": {"build": "echo ''No build needed''"}}'
Set-Content -Path "$tempDir\package.json" -Value $dummyPkg

# 6. Git Commit und Push (Inkrementell!)
Write-Host "Pushe kombiniertes Build in den 'production'-Branch..." -ForegroundColor Cyan
Push-Location $tempDir

git config windows.appendAtomically false
git config user.name "ImmoControl Admin"
git config user.email "admin@immocontrol360.de"

# Falls das Repository neu initialisiert werden musste
if (!(git remote)) {
    git remote add origin https://github.com/jxxx87/immocontrol360.git
    git checkout -B production
}

git add -A
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
