# 🏠 HausPlan

Eine kleine Web-App, die **Haushaltsaufgaben** und **Homeoffice-Aufgaben** an einem Ort organisiert.
Läuft komplett im Browser, funktioniert offline und lässt sich auf dem Handy wie eine App installieren.

## Funktionen

- **Heute** – überfällige und heute fällige Aufgaben mit Tagesfortschritt und Restzeit
- **Woche** – die nächsten 7 Tage im Überblick (inkl. geschätzter Minuten pro Tag)
- **Alle** – alle Aufgaben gruppiert nach Bereich und Raum/Projekt
- **Statistik** – erledigte Aufgaben pro Person und Bereich, Zeitaufwand, Serie 🔥
- **Wiederholungen** – täglich, werktags, wöchentlich, alle 2 Wochen, monatlich oder alle X Tage
- **Personen** – Aufgaben Haushaltsmitgliedern zuweisen und danach filtern
- Erledigen mit **Rückgängig**, Verschieben um einen Tag, Prioritäten, Notizen
- **Export/Import** als JSON (Sicherung oder Übertragen auf ein anderes Gerät)
- Heller und dunkler Modus (automatisch)

## Starten

Keine Installation nötig. Einen beliebigen statischen Webserver im Projektordner starten, z. B.:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen. Auf dem Smartphone über „Zum Startbildschirm hinzufügen“ installieren.

> Die Daten werden im `localStorage` des Browsers gespeichert – also nur auf dem jeweiligen Gerät.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst und Aufgaben-Dialog |
| `styles.css` | Gestaltung (inkl. Dark Mode, mobil optimiert) |
| `app.js` | Logik: Aufgaben, Wiederholungen, Ansichten, Statistik |
| `sw.js`, `manifest.json`, `icon.svg` | PWA: Offline-Nutzung und Installation |
