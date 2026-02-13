---
description: Backup des src-Ordners erstellen
---

# Backup erstellen

// turbo-all

1. Erstelle ein Backup des `src`-Ordners im `backup/`-Verzeichnis mit Zeitstempel:

```bash
cd /Users/nathalie/Library/CloudStorage/OneDrive-Persönlich(2)/Johann/Excel/ImmoControlpro360/immo-web && rm -rf backup/src_backup_latest && cp -R src backup/src_backup_latest
```

2. Bestätige dem User, dass das Backup erstellt wurde.

## Wiederherstellen

Falls der User ein Backup wiederherstellen möchte:

```bash
cd /Users/nathalie/Library/CloudStorage/OneDrive-Persönlich(2)/Johann/Excel/ImmoControlpro360/immo-web && cp -R backup/src_backup_latest/* src/
```
