# VERALTET - gesperrt (Komplett-Check 2026-11-27, W1c-15)
#
# Dieses Skript hat frueher nur die Marketing-Website in den Branch "production-landing" gepusht.
# Hostinger serviert inzwischen den Branch "production", der von immo-web\deploy_all.ps1 gebaut wird
# (Marketing-Website im Root, Web-App unter /app). Ein Push nach "production-landing" geht nicht live.
#
# Die alte Fassung war zudem gefaehrlich: Exitcodes von git wurden nicht geprueft
# ($ErrorActionPreference = "Stop" greift in Windows PowerShell 5.1 nicht bei nativen Programmen),
# "git checkout -B landing-master" setzte den Branch hart auf den aktuellen Stand, und
# "git reset HEAD~1" konnte nach einem fehlgeschlagenen Commit den letzten ECHTEN Commit entfernen.
# Die alte Fassung ist in der Git-Historie dieses Repos weiterhin einsehbar.
#
# Richtiges Vorgehen (siehe CLAUDE.md, Abschnitt 3):
#   PowerShell im Ordner immo-web oeffnen und  .\deploy_all.ps1  ausfuehren.

Write-Host "deploy_marketing.ps1 ist veraltet und gesperrt." -ForegroundColor Red
Write-Host "Bitte stattdessen im Ordner immo-web ausfuehren:  .\deploy_all.ps1" -ForegroundColor Yellow
exit 1
