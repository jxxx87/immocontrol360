# Kombiniertes Deployment: Marketing-Website (Root /) + Web-App (/app) -> Branch "production" auf GitHub.
# Hostinger stellt den Branch production bereit: Root = immocontrol360.de, /app = app.immocontrol360.de.
# Aufruf (aus jedem Verzeichnis):  .\deploy_all.ps1   bzw.   powershell -File <Pfad>\immo-web\deploy_all.ps1
#
# Komplett-Check 2026-11-27:
# - Jeder npm-/git-Aufruf wird geprüft. Bei einem Fehler bricht das Skript ab, BEVOR etwas veröffentlicht wird.
# - Pfade relativ zum Skript ($PSScriptRoot) statt zum aktuellen Verzeichnis.
# - Nach dem Build wird geprüft, dass beide dist\index.html in diesem Lauf neu geschrieben wurden.
# - Die Arbeitskopie des production-Branches liegt unter %TEMP% (nicht im OneDrive-Ordner) und wird immer entfernt.
# - Kein Force-Push und kein Rückfall auf ein leeres Repository mehr: die production-Historie bleibt erhalten.
# - Die Commit-Nachricht nennt die Quell-Commits beider Repos (git rev-parse HEAD) und markiert,
#   wenn nicht committete Änderungen mitgebaut wurden.

$ErrorActionPreference = "Stop"

$startZeit = Get-Date
$repoUrl   = "https://github.com/jxxx87/immocontrol360.git"
$webDir    = $PSScriptRoot
$siteDir   = Join-Path (Split-Path -Parent $PSScriptRoot) "immowebsite"
$tempDir   = Join-Path $env:TEMP ("immocontrol360_deploy_" + $startZeit.ToString("yyyyMMdd_HHmmss"))

# Bricht ab, wenn der unmittelbar vorher aufgerufene native Befehl (npm/git) fehlgeschlagen ist.
# Hinweis: $ErrorActionPreference = "Stop" greift in Windows PowerShell 5.1 NICHT bei Exit-Codes nativer Programme.
function Assert-ExitCode([string]$schritt) {
    if ($LASTEXITCODE -ne 0) {
        throw "$schritt ist fehlgeschlagen (Exit-Code $LASTEXITCODE). Abbruch - es wurde nichts veröffentlicht."
    }
}

# Liefert "<name>: <commit> (<branch>)" und warnt bei nicht committeten Änderungen.
function Get-QuellStand([string]$dir, [string]$name) {
    $sha = git -C $dir rev-parse HEAD
    Assert-ExitCode "git rev-parse ($name)"
    $branch = git -C $dir rev-parse --abbrev-ref HEAD
    Assert-ExitCode "git rev-parse --abbrev-ref ($name)"
    $offen = git -C $dir status --porcelain
    Assert-ExitCode "git status ($name)"
    $text = "${name}: $sha ($branch)"
    if ($offen) {
        Write-Host "Hinweis: $name hat nicht committete Änderungen - der Live-Stand entspricht dann nicht exakt dem Commit $sha." -ForegroundColor Yellow
        Write-Host "         Empfehlung: vorher committen und den Branch $branch pushen." -ForegroundColor Yellow
        $text += " + nicht committete Aenderungen"
    }
    return $text
}

function Invoke-Build([string]$dir, [string]$name) {
    Write-Host "Baue $name..." -ForegroundColor Cyan
    Push-Location $dir
    try {
        npm run build
        Assert-ExitCode "npm run build ($name)"
    } finally {
        Pop-Location
    }
    $index = Join-Path $dir "dist\index.html"
    if (-not (Test-Path $index)) {
        throw "Der Build von $name hat keine dist\index.html erzeugt. Abbruch - es wurde nichts veröffentlicht."
    }
    if ((Get-Item $index).LastWriteTime -lt $startZeit.AddSeconds(-5)) {
        throw "dist\index.html von $name stammt nicht aus diesem Lauf (Build hat nichts geschrieben). Abbruch - es wurde nichts veröffentlicht."
    }
}

Write-Host "Starte kombiniertes Deployment (Marketing-Website + Web-App)..." -ForegroundColor Cyan

# 0. Voraussetzungen
foreach ($p in @((Join-Path $webDir "package.json"), (Join-Path $siteDir "package.json"))) {
    if (-not (Test-Path $p)) { throw "Nicht gefunden: $p - liegt das Skript im Ordner immo-web neben immowebsite?" }
}
$quelleWeb  = Get-QuellStand $webDir "immo-web"
$quelleSite = Get-QuellStand $siteDir "immowebsite"

# 1. + 2. Beide Projekte bauen (bricht bei einem Build-Fehler ab)
Invoke-Build $siteDir "Marketing-Website (immowebsite)"
Invoke-Build $webDir "Web-App (immo-web)"

$veroeffentlicht = $false
try {
    # 3. Arbeitskopie des production-Branches holen (flach). Schlägt das fehl, wird abgebrochen -
    #    niemals ein leeres Repository anlegen, das die Historie ersetzen würde.
    Write-Host "Hole den Branch 'production' (Arbeitskopie unter $tempDir)..." -ForegroundColor Cyan
    git clone --branch production --depth 1 $repoUrl $tempDir
    Assert-ExitCode "git clone (Branch production)"

    Push-Location $tempDir
    try {
        # Alle vorhandenen Dateien löschen, außer dem .git-Ordner
        Get-ChildItem -Force -Exclude .git | Remove-Item -Recurse -Force

        # 4. Dateien kopieren
        Write-Host "Kopiere Marketing-Dateien (in Root)..." -ForegroundColor Cyan
        Copy-Item -Path (Join-Path $siteDir "dist\*") -Destination $tempDir -Recurse -Force

        Write-Host "Kopiere Web-App-Dateien (in /app)..." -ForegroundColor Cyan
        $appDir = Join-Path $tempDir "app"
        New-Item -ItemType Directory -Path $appDir -Force | Out-Null
        Copy-Item -Path (Join-Path $webDir "dist\*") -Destination $appDir -Recurse -Force

        foreach ($p in @("index.html", "app\index.html", "app\.htaccess")) {
            if (-not (Test-Path (Join-Path $tempDir $p))) { throw "Nach dem Kopieren fehlt $p. Abbruch - es wurde nichts veröffentlicht." }
        }

        # 5. Dummy package.json im Root, damit die Hostinger-Prüfung besteht
        Write-Host "Erstelle Hostinger-Dummy-package.json..." -ForegroundColor Cyan
        $dummyPkg = '{"name": "immocontrol360-combined", "version": "1.0.0", "scripts": {"build": "echo ''Build complete''", "start": "echo ''Static hosting''"}}'
        Set-Content -Path (Join-Path $tempDir "package.json") -Value $dummyPkg -Encoding ASCII

        # 6. Commit und normaler Push (Fast-Forward auf den geklonten Stand, kein --force)
        git config windows.appendAtomically false
        git config user.name "ImmoControl Admin"
        git config user.email "admin@immocontrol360.de"

        git add -A
        Assert-ExitCode "git add"
        $aenderungen = git status --porcelain
        Assert-ExitCode "git status (production)"

        if (-not $aenderungen) {
            Write-Host "Das Build-Ergebnis ist identisch mit dem Live-Stand - nichts zu veröffentlichen." -ForegroundColor Yellow
        } else {
            Write-Host "Pushe kombiniertes Build in den Branch 'production'..." -ForegroundColor Cyan
            $gebaut = "Gebaut: " + $startZeit.ToString("yyyy-MM-dd HH:mm:ss") + " auf " + $env:COMPUTERNAME
            git commit -m "Deploy Combined Build Artifacts" -m "Quelle $quelleWeb" -m "Quelle $quelleSite" -m $gebaut
            Assert-ExitCode "git commit"
            git push origin production
            Assert-ExitCode "git push (production; bei 'rejected' wurde production zwischenzeitlich geändert - Skript einfach erneut starten)"
            $veroeffentlicht = $true
        }
    } finally {
        Pop-Location
    }
} finally {
    # 7. Aufräumen - auch nach einem Fehler
    if (Test-Path $tempDir) {
        Write-Host "Bereinige temporäre Dateien..." -ForegroundColor Cyan
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($veroeffentlicht) {
    Write-Host "--------------------------------------------------------" -ForegroundColor Green
    Write-Host "Kombiniertes Deployment erfolgreich hochgeladen!" -ForegroundColor Green
    Write-Host $quelleWeb -ForegroundColor Green
    Write-Host $quelleSite -ForegroundColor Green
}
Write-Host "Hostinger-Einstellungen (Git, Hauptdomain immocontrol360.de), falls noch nicht eingerichtet:" -ForegroundColor White
Write-Host "1. Repository: $repoUrl
2. Zweig (Branch): production
3. Framework-Voreinstellung: Other
4. Build-Befehl: npm run build (oder falls Hostinger meckert: ""echo done"")
5. Ausgabeverzeichnis: .
--------------------------------------------------------------------"
