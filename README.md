# 🏠 HausPlan

Eine Web-App, mit der ein ganzer Haushalt **Haushaltsaufgaben** und **Homeoffice-Aufgaben** gemeinsam organisiert.
Alle Personen sehen dieselben Aufgaben, können Aufgaben eintragen, übernehmen und abhaken. Änderungen erscheinen sofort auf allen Geräten.

## Funktionen

- **Gemeinsam nutzen:** ein zentraler Datenstand für alle, Live-Updates ohne Neuladen
- **Wer bist du?** Jede Person wählt auf dem eigenen Gerät, wer sie ist. Dadurch sieht man, wer was angelegt und erledigt hat.
- **Benachrichtigung im Browser**, z. B. „Anna hat ‚Bad putzen‘ erledigt ✓“
- **Verlauf:** wer hat wann was gemacht
- **Statistik:** erledigte Aufgaben und Zeitaufwand pro Person, nach Bereich, Serie 🔥
- **Heute / Woche / Alle** als Ansichten, Filter nach Bereich und Person („⭐ Meine Aufgaben“)
- **Wiederholungen:** täglich, werktags, wöchentlich, alle 2 Wochen, monatlich, alle X Tage
- Aufgaben einer Person zuweisen oder für „wer Zeit hat“ offen lassen
- Rückgängig, Verschieben um einen Tag, Prioritäten, Dauer, Notizen
- **Haushalts-Code** als Zugangsschutz
- Export/Import als JSON-Sicherung, Dunkelmodus, auf dem Handy installierbar

## Starten (gemeinsame Nutzung)

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18. Weitere Pakete sind nicht nötig.

```bash
HAUSPLAN_CODE=euer-geheimer-code npm start
```

Der Server zeigt beim Start die Adressen an, zum Beispiel:

```
🏠 HausPlan läuft auf http://localhost:3000
   Im Heimnetz: http://192.168.178.20:3000
```

Alle im Haushalt öffnen die **Heimnetz-Adresse** auf Handy oder Laptop, geben den Code ein und wählen ihren Namen.
Auf dem Handy über „Zum Startbildschirm hinzufügen“ wie eine App installieren.

Am besten läuft der Server auf einem Gerät, das immer an ist (z. B. Raspberry Pi, NAS oder ein kleiner Server).

| Variable | Bedeutung | Standard |
|---|---|---|
| `HAUSPLAN_CODE` | Haushalts-Code zum Anmelden. **Ohne Code kann jede Person im Netz zugreifen.** | – |
| `PORT` | Port | `3000` |
| `HOST` | Adresse, auf der der Server lauscht | `0.0.0.0` |
| `DATA_DIR` | Ordner für die Daten | `./data` |

Die Daten liegen in `data/hausplan.json`. Für eine Sicherung diese Datei kopieren oder in der App unter ⚙️ exportieren.

> **Zugriff von unterwegs:** Der Server ist für das Heimnetz gedacht. Wer ihn ins Internet stellen will,
> sollte ihn hinter einen HTTPS-Proxy (z. B. Caddy oder nginx) setzen und einen langen Code verwenden.

## Ohne Server (nur ein Gerät)

Den Ordner `public/` mit einem beliebigen statischen Webserver öffnen (z. B. `cd public && python3 -m http.server`).
Die App erkennt, dass kein Server da ist, und speichert dann nur im Browser dieses Geräts.

## Tests

```bash
npm test
```

## Aufbau

| Datei | Inhalt |
|---|---|
| `server.js` | Server: Anmeldung, gemeinsame Daten, Live-Updates (Server-Sent Events) |
| `public/shared.js` | Gemeinsame Logik für Browser und Server: Aufgaben-Aktionen, Wiederholungen, Prüfung der Eingaben |
| `public/app.js` | Oberfläche: Ansichten, Dialoge, Synchronisierung |
| `public/index.html`, `public/styles.css` | Grundgerüst und Gestaltung |
| `public/sw.js`, `manifest.json`, `icon.svg` | Offline-Cache und Installation als App |
| `test/` | Tests der gemeinsamen Logik |

Jede Änderung (Aufgabe anlegen, erledigen, …) wird als *Aktion* an den Server geschickt. Der Server wendet sie
nacheinander an, speichert sie und verteilt den neuen Stand an alle Geräte. Wenn zwei Personen gleichzeitig
dieselbe einmalige Aufgabe abhaken, zählt nur die erste. Die zweite Person bekommt einen Hinweis.
