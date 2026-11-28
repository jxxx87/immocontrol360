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
#
# Welle 3 (27.11.2026, X1-03 / X1-21):
# - Abbruch, wenn eines der Repos nicht committete Änderungen hat oder sein Commit noch nicht auf GitHub
#   (origin/<branch>) liegt – der Live-Stand muss genau einem gepushten Commit entsprechen.
#   Ablauf daher: committen, master bzw. landing-master pushen, dann deployen.
#   Notfall-Schalter: .\deploy_all.ps1 -AllowDirty  (baut trotzdem und markiert den Stand als nicht reproduzierbar)
# - Vor dem Build laufen in immo-web "npm run lint" und "npm test"; ein Fehler bricht ab.
#   Notfall-Schalter: -SkipChecks
# - app/version.json nennt Quell-Commits und Build-Zeitpunkt (abrufbar unter https://app.immocontrol360.de/version.json).
#   Hinweis: Die Skripte ohne Umleitung (*>&1 / 2>&1) aufrufen – sonst wertet PowerShell 5.1 npm-Warnungen als Fehler.

param(
    [switch]$AllowDirty,
    [switch]$SkipChecks
)

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

# Liefert "<name>: <commit> (<branch>)". Bricht ab, wenn der Stand nicht genau einem gepushten Commit
# entspricht (nicht committete Änderungen, kein Branch, Commit nicht auf origin) – außer mit -AllowDirty.
function Get-QuellStand([string]$dir, [string]$name) {
    $sha = git -C $dir rev-parse HEAD
    Assert-ExitCode "git rev-parse ($name)"
    $branch = git -C $dir rev-parse --abbrev-ref HEAD
    Assert-ExitCode "git rev-parse --abbrev-ref ($name)"
    $offen = git -C $dir status --porcelain
    Assert-ExitCode "git status ($name)"
    $text = "${name}: $sha ($branch)"

    $probleme = @()
    if ($offen) { $probleme += "nicht committete Aenderungen" }
    if ($branch -eq "HEAD") {
        $probleme += "kein Branch ausgecheckt (detached HEAD)"
    } else {
        git -C $dir fetch --quiet origin $branch
        Assert-ExitCode "git fetch origin $branch ($name)"
        git -C $dir merge-base --is-ancestor HEAD "origin/$branch"
        if ($LASTEXITCODE -eq 1) {
            $probleme += "Commit noch nicht nach origin/$branch gepusht"
        } elseif ($LASTEXITCODE -ne 0) {
            throw "git merge-base ($name) ist fehlgeschlagen (Exit-Code $LASTEXITCODE). Abbruch - es wurde nichts veröffentlicht."
        }
    }

    if ($probleme.Count -gt 0) {
        $liste = $probleme -join "; "
        if (-not $AllowDirty) {
            throw "${name}: $liste. Der Live-Stand wäre nicht auf einen Commit auf GitHub rückführbar. Erst committen und den Branch pushen (Notfall: .\deploy_all.ps1 -AllowDirty). Abbruch - es wurde nichts veröffentlicht."
        }
        Write-Host "Warnung (${name}): $liste - Deploy trotzdem, weil -AllowDirty gesetzt ist." -ForegroundColor Yellow
        $text += " + NICHT REPRODUZIERBAR ($liste)"
    }
    return $text
}

# Lint und Tests (nur immo-web; die Website hat keine Tests). Bricht beim ersten Fehler ab.
function Invoke-Pruefungen([string]$dir, [string]$name) {
    Write-Host "Prüfe $name (npm run lint, npm test)..." -ForegroundColor Cyan
    Push-Location $dir
    try {
        npm run lint
        Assert-ExitCode "npm run lint ($name)"
        npm test
        Assert-ExitCode "npm test ($name)"
    } finally {
        Pop-Location
    }
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

# 0b. Lint und Tests der Web-App
if ($SkipChecks) {
    Write-Host "Hinweis: Lint und Tests übersprungen (-SkipChecks)." -ForegroundColor Yellow
} else {
    Invoke-Pruefungen $webDir "Web-App (immo-web)"
}

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

        # Herkunft des Live-Stands: https://app.immocontrol360.de/version.json
        $versionInfo = [ordered]@{
            gebaut  = $startZeit.ToString("yyyy-MM-ddTHH:mm:sszzz")
            web     = $quelleWeb
            website = $quelleSite
        }
        $versionInfo | ConvertTo-Json | Set-Content -Path (Join-Path $appDir "version.json") -Encoding UTF8

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
