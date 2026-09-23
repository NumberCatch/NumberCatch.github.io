# NumberCatch

Mobile-first Angular-PWA für die gemeinsame Suche nach Autonummern in aufsteigender Reihenfolge. Die Anwendung nutzt Supabase Auth, Postgres und MapLibre. Funde werden bei bestehender Internetverbindung direkt in Supabase gespeichert.

## Live-App

[NumberCatch öffnen](https://numbercatch.github.io/)

## Lokal starten

```sh
npm ci
npm start
```

Die öffentliche Supabase-URL und der Publishable Key stehen in den Angular-Environment-Dateien. Im Frontend darf ausschließlich der öffentliche Publishable Key verwendet werden.

## Supabase

1. Neues Supabase-Projekt anlegen.
2. Alle Dateien unter `supabase/migrations/` in aufsteigender Reihenfolge anwenden (SQL Editor oder die bestehende Supabase-GitHub-Integration).
3. E-Mail-Auth aktivieren und die Site URL auf die GitHub-Pages-URL setzen.

Die RLS-Policies erlauben private Sightings nur ihrem Ersteller; Gruppenprofile werden nur über gemeinsame Gruppen sichtbar. Vollständige Kennzeichen werden nicht gespeichert.

Die zusätzliche Migration `20260918000001_groups_and_avatars.sql` legt den öffentlichen Avatar-Bucket mit benutzerspezifischen Upload-Policies an und korrigiert die Gruppen-RLS-Abfragen.

`20260918000004_atomic_sightings.sql` muss **vor dem Deployment des zugehörigen Frontends** angewendet werden. Sie speichert Fund und Fortschritt gemeinsam über `capture_sighting`, serialisiert gleichzeitige Funde pro Benutzer und verhindert doppelte Bestätigungen. Direkte Fortschrittsänderungen und direkte Fund-Inserts aus dem Browser werden gesperrt. Name und Avatar bleiben bearbeitbar; eigene Vormerkungen bleiben löschbar.

Die Migration löscht keine Daten. Falls noch doppelte bestätigte Zahlen existieren, schlägt die Erstellung des eindeutigen Index fehl; diese Einträge müssen vorher geprüft und bereinigt werden. Bereits vorhandene Fortschrittswerte werden nicht neu berechnet. Höhere Zahlen können weiterhin mehrfach vorgemerkt werden; Vormerkungen werden niemals automatisch bestätigt.

Die Migration `20260918000005_remove_number_limit.sql` entfernt die bisherige Spielgrenze von 999 aus Tabellen und Erfassungsfunktion. Auch bestehende Datenbanken benötigen diese Migration, bevor Zahlen über 999 gespeichert werden können. Bestehende Daten bleiben erhalten. Erlaubt sind positive ganze Zahlen; es gibt keine fachliche Obergrenze mehr. Technisch bleibt der PostgreSQL-Datentyp `integer` auf 2.147.483.647 begrenzt. Die Übersicht zeigt weiterhin den höchsten Fortschritt plus 20 Zahlen.

## Prüfungen

```sh
npm run lint
npm run format:check
npm test -- --progress=false
npm run test:db
npm run build
```

Die Frontend-Tests laufen mit Vitest und jsdom. Die Datenbanktests führen die echten Migrationen mit PGlite in einer isolierten PostgreSQL-Testdatenbank aus. Supabase-eigene Auth-/Storage-Schemas sind dafür minimal nachgebildet; es wird keine Cloud-Datenbank angesprochen. Sie prüfen Transaktionen, Reihenfolge, Duplikatschutz und Rechte. PGlite simuliert keine parallelen Datenbankverbindungen.

## GitHub Pages

1. In `Settings → Pages` die Quelle `GitHub Actions` wählen.
2. Nach dem ersten erfolgreichen Deployment ist die App unter [numbercatch.github.io](https://numbercatch.github.io/) erreichbar.
3. In Supabase unter `Authentication → URL Configuration` diese URL als Site URL und als erlaubte Redirect-URL eintragen: `https://numbercatch.github.io`.


