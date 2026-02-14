---
description: Backup des src-Ordners erstellen
---

# Backup erstellen

// turbo-all

1. Erstelle ein Backup des `src`-Ordners im `backups/`-Verzeichnis mit Zeitstempel:

```powershell
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupDir = "backups\src_backup_$timestamp"
New-Item -ItemType Directory -Force -Path $backupDir
Copy-Item -Path "src" -Destination $backupDir -Recurse
Write-Host "Backup created at $backupDir"
```

2. Bestätige dem User, dass das Backup erstellt wurde.

## Wiederherstellen

Falls der User ein Backup wiederherstellen möchte:

```bash
cd /Users/nathalie/Library/CloudStorage/OneDrive-Persönlich(2)/Johann/Excel/ImmoControlpro360/immo-web && cp -R backup/src_backup_latest/* src/
```
