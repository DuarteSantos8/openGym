# Plan: Cardio-Geräte per QR/NFC mit openGym verbinden (nach dem Vorbild von LFconnect)

## Kontext

Im Studio verbindet die alte Life-Fitness-App (LFconnect, Android-Paket `com.lf.lfvtandroid` 3.9.5)
das Handy mit einem Cardio-Gerät, z. B. einem Fahrrad: Am Gerät startet man ein Workout und öffnet das
Verbindungsmenü, das einen QR-Code zeigt. Die App scannt den Code und verbindet sich. Nach dem Training
kommen Strecke, kcal, Zeit usw. aufs Handy.
Diese Funktion soll in **openGym** (https://github.com/DuarteSantos8/openGym, React 19 + Vite +
**Capacitor 7** mit `ios/` und `android/`) nachgebaut werden. Umfang laut Nutzer: **Verbinden,
Live-Werte, Ergebnis speichern und Gerät steuern** (Widerstand, Steigung, Watt, Zielpuls, Programme).

Dieser Plan ist die Übergabe an einen Agenten mit openGym-Know-how. Teil A beschreibt das Protokoll,
wie es aus dem dekompilierten APK hervorgeht. Teil B beschreibt den Einbau.
Quellcode-Referenz (jadx): `D:\lifefitness\out\jadx_lfvt_full\sources\` (Pfade unten relativ dazu).

---

## Teil A — So funktioniert es in LFconnect

### A1. QR-Code bzw. NFC-Tag
- Beide enthalten **dieselbe URL**. NFC ist ein NDEF-URI-Record: Byte 0 ist der URI-Präfix-Code, der Rest
  ist die URL (`com/lf/lfvtandroid/ui/MainActivity.java` ~5415). Danach laufen QR und NFC gleich weiter.
- Die URL wird nur akzeptiert, wenn sie `lfconnect` oder `halo.fitness` enthält (`s9/b.java` `c()`).
  Beispiel: `https://lfconnect.com/q?t=c&...`. Enthält die URL `vtqa`, ist es die QA-Umgebung.
- Klassifizierung (`s9/b.java`, `QrCodeLoginViewModel.B()`):
  | Bedingung | Typ | Bedeutung |
  |---|---|---|
  | `t=c` + `s=` | 3 | Bellus-Konsole, Login übers Internet (für uns irrelevant) |
  | `t=c` + `r=` | 7 | **Ergebnis-QR**: `r` ist Base64-JSON mit der Workout-Zusammenfassung, kein BLE nötig (`aa/b.java`) |
  | `t=c` (sonst) | 4 | **Cardio-Verbindung per BLE**, das ist unser Hauptfall |
  | `t=s` … | 1/2/9 | Kraftgeräte, nicht Teil dieses Plans |
  | 13 durch `/` getrennte Felder | 10 | ICG-LCD-Rower |
- Parameter bei Typ 4 (`com/lf/api/LFQR.java`, Klasse `LFDiscoverLoginInfo`):
  `a` = BT-Kennung (MAC-Fragment), `u` = UUID-Fragment, `l` = Seriennummer (bodySerial),
  `x` = securityId / discoverSessionId, `c=1` = Konsole ist online.

### A2. Verbindungsaufbau (`com/lf/api/WorkoutManager.java` `connectBluetoothLE` ~3120–3218)
1. BLE-Scan ohne Filter mit Scan-Modus „low latency“ und **10 s Timeout**. Wird nichts gefunden, kommt
   `CannotFindBleException` („maybe someone is connected to it already“).
2. Ein Treffer liegt vor, wenn der **Gerätename** `a` oder `u` enthält (Groß-/Kleinschreibung egal,
   `matchDevice`). Das funktioniert auch auf iOS, weil iOS keine MACs herausgibt, aber der Name genügt.
3. Die Protokollversion ergibt sich aus den Service-UUIDs in der Advertisement:
   - FTMS `0x1826` ohne Wahoo-UUID → **LFopen v3 („LFopen2 Flow“)**. Moderne Konsolen nutzen das; wir setzen es zuerst um.
   - Wahoo `a026ee07-0a7d-4ab3-97fa-f1500f9feb8b` → LFopen v2 (`com/lf/ble/wahoo/WahooFlow.java`)
   - weder noch → LFopen v1 (älteres Byte-Protokoll, `BLEAdapter`/`ProtocolCommand`)
   - Gerätetyp = die letzten 3 Ziffern des Gerätenamens (Name hat 18 Zeichen, Typ an Index 15–17).

### A3. LFopen v3: GATT-Ablauf (`com/lf/ble/lfopen2/**`)
UUIDs stehen in `com/lf/ble/lfopen2/ftms/LFOpen2ServiceBuilder.java`. Die wichtigsten:
- LF-Datenservice `FB694B90-F49E-4597-8306-171BBA78F846`: `CURRENT_STATE 5da551de…`,
  `CLIENT_MESSAGE 5da558dc…`, `WORKOUT_SUMMARY 5da552a6…`, `CONSOLE_NOTIFICATION 5da55aa8…`,
  `PRESET_SUMMARY 5da569e2…`, `SELECT_PRESET 5da56ab6…`, `START_PRESET 5da569e4…`,
  `SET_LEVEL ce78f4e8…`, `SET_INCLINE ce78f164…`, `SET_WATTS ce78f330…`, `SET_TARGET_HR ce78fb00…`,
  `DISPLAY_MESSAGE ce78fd94…`
- User-Data-Service `FB694B91-…`: Standard-Charakteristiken (2A8A Vorname, 2A90 Nachname, 2A87 E-Mail,
  2A80 Alter, 2A8C Geschlecht, 2AA2 Sprache, 2A98 Gewicht, 2A8E Größe …) plus `HMAC 5da54cf2…` und
  `MEASUREMENT_UNIT ce78e85e…`
- FTMS `0x1826`: Indoor Bike Data `2AD2`, Treadmill `2ACD`, Cross Trainer `2ACE`, Stair `2AD0`,
  Training Status `2AD3`, Machine Status `2ADA`

Ablauf mit drei Zustandsautomaten (EasyFlow):
1. **InitializeFlow**: `connectGatt(autoConnect=false, LE)`, nach dem Verbinden **MTU 517** anfordern.
   Nutzbare Nutzlast ist `mtu − 100`, bei MTU-Fehler 20. Danach Services discovern und Notifications
   aktivieren für CURRENT_STATE, WORKOUT_SUMMARY, CLIENT_MESSAGE, CONSOLE_NOTIFICATION.
2. **LoginFlow** (`LoginFlow.java`): Jeder Schritt ist ein Write, der nächste folgt erst nach dem
   Write-ACK (GATT-Status 0).
   - `CLIENT_MESSAGE ← [0x01]` (Login starten), dann warten, bis CURRENT_STATE `[0x07]` meldet (Login bestätigt)
   - danach in dieser Reihenfolge: Vorname, Nachname, E-Mail, Alter (uint16 LE), Geschlecht, Sprache,
     **HMAC (nur wenn vorhanden, sonst überspringen)**, Einheit, Gewicht, Größe. VO2max und Max-HF werden übersprungen.
   - Preset-Summary (JSON-Liste `{workoutId, workoutName, fileName, index, workoutType}`) in Chunks
     an PRESET_SUMMARY, dann `CLIENT_MESSAGE ← [0x02]` (Daten komplett)
   - warten, bis CURRENT_STATE `[0x04, 0x01]` meldet → eingeloggt
   - Ohne Nutzerprofil schickt die App leere Namen (`" "`). Ein LF-Account wird nicht gebraucht.
3. **WorkoutFlow** (`WorkoutFlow.java`):
   - Steht der FTMS Training Status auf 13 oder 14 oder der Machine Status auf 4 (läuft), abonniert die
     App die FTMS-Daten-Charakteristiken (CCCD `01 00`) und erhält **Live-Stream-Daten**
     (`FTMBikeData` usw., Standard-FTMS-Format).
   - Machine Status `0x02` = pausiert, `0x04` = fortgesetzt
   - Wählt man am Gerät ein Preset (CURRENT_STATE `[21, ?, index]`), lädt die App das Preset-XML
     Base64-codiert in Chunks hoch.
   - **Zusammenfassung**: Am Workout-Ende meldet die Konsole WORKOUT_SUMMARY. Die App liest die
     Charakteristik bzw. bekommt Notifications und quittiert jeden Chunk mit einem leeren Write.
     Chunk-Format: `[seq u16 BE][total u16 BE][checksum u8][payload]`. Die Checksumme ist die
     Byte-Summe mod 256. Bei falscher Checksumme wird der Chunk verworfen. Ist `seq==0` und die Nutzlast
     schon gültiges JSON, ist die Zusammenfassung fertig. Sonst wird zusammengesetzt, bis `total` Chunks da sind.
     Danach `gatt.close()`.
   - Chunks, die die App schickt (Presets), haben dasselbe Format: `[0, idx, 0, total, checksum] + data`.
   - Steuerung: SET_LEVEL `[u8]`, SET_INCLINE `u16 LE (Prozent × 10)`, SET_WATTS `u16 LE`,
     SET_TARGET_HR `u16 LE`
4. **Ergebnis-JSON** (`com/lf/api/WorkoutResult.java` `setEquipmentResultFromQR`). Dasselbe Format kommt
   auch im Ergebnis-QR (`r=`):
   `bs` Seriennummer, `id` GUID, `t` Gerätemodell, `et` Dauer (s), `c` kcal,
   `d{v,u}` Distanz, `dc{v,u}` Höhenmeter bzw. Etagen/Stufen (bei den Modellen 44/45/60–63),
   `as` Durchschnittstempo, `ap` Pace „mm:ss“, `ai` Steigung, `al` Level, `ahr` Puls,
   `am` METs, `aw` Watt, `ar` U/min, `asl` Schrittlänge, `dt` Datum (mehrere Formate).
   **Die Bedeutung von `u` (Distanzeinheit) ist noch offen**: im APK nachschauen, wo `distanceUnit` gelesen wird.

### A4. Fehlerbehandlung (`ui/shared/delegates/CardioBarcodeUrlHandlerHelper.java`, `d5/q.java`)
- **Watchdog je Phase**: Mit jedem neuen Verbindungszustand startet ein CountDownTimer neu.
  Timeouts (`data/model/bluetooth/ConnectionState.java`): INIT 10 s, BLE_FOUND 5 s, BLE_CONNECTED 5 s,
  PRESETS_FETCHED 10 s, WAHOO_BLE_CONNECTED 10 s, WAHOO_BLE_DISCOVERED 30 s.
  Ist CONNECTED erreicht, werden alle Timer gestoppt.
- Bei Timeout, DISCONNECT oder ERROR: `logout()`, `clean()` und `stop()` aufrufen, Abos beenden und eine
  Meldung mit Fehlercode zeigen: `B501`…`B504` plus Suffix `1` (Timeout) bzw. `2` (Fehler),
  sonst `B600`. Text: „QR erneut scannen“ bzw. „erneut versuchen“.
- Weitere Meldungen: ungültiger QR-Code, NetworkError, TimeoutError, „Verbindung nicht verfügbar“.
  `CannotFindBleException` heißt: Gerät nicht gefunden, eventuell schon belegt.
- Doppel-Scans verhindert ein `processing`-Flag, das beim Zurückkehren in die App (onResume) zurückgesetzt wird.

### A5. Verbindung während des Workouts halten
- **Kein Keep-alive-Protokoll.** Die BLE-Verbindung bleibt einfach offen, die Konsole schickt
  Notifications (Status und Stream).
- Android: `services/CardioEquipmentConnectionService.java` ist ein **Foreground-Service** mit
  Benachrichtigung. Er verteilt Stream, Ergebnis und Verbindungszustand per RxJava-Subjects
  (`data/bluetooth/LFOpenDataSource.java` f9427d/e/f) und beendet sich, wenn Bluetooth ausgeschaltet wird.
  Pulswerte von einem gekoppelten Brustgurt reicht er an die Konsole weiter (`writeSensorData`).
- **Kein automatischer Reconnect.** Bricht die Verbindung vor dem Workout-Ende ab, ist die
  Zusammenfassung verloren. Das bauen wir in openGym besser.

---

## Teil B — Einbau in openGym (für den openGym-Agenten)

### B0. Zwei Wege, zwei Plattformklassen
| Weg | Wann | Wo es läuft |
|---|---|---|
| **Ergebnis-QR** (`t=c&r=<Base64-JSON>`) | Am Ende des Workouts zeigt das Fahrrad einen QR-Code, wenn **keine** App verbunden war. Der Nutzer hat das bestätigt: Scannen überträgt alle Daten. | **PWA/Web und native App**, ohne Bluetooth |
| **Live-Verbindung per BLE** (`t=c` ohne `r`/`s`) | Verbindungsmenü am Gerät, während des Workouts | **nur in der nativen App** (iOS-Safari/PWA hat kein Web Bluetooth) |

- Ermittlung der Bluetooth-Fähigkeit: `canUseBle = Capacitor.isNativePlatform()`. Optional im Web
  zusätzlich `'bluetooth' in navigator` (Chrome/Android), doch im ersten Schritt reicht „nur nativ“.
- **Fehlerfall: Verbindungs-QR in der PWA bzw. ohne BLE gescannt.** Kein Verbindungsversuch, sondern eine
  verständliche Meldung, z. B.:
  > „Die Live-Verbindung zum Gerät funktioniert nur in der openGym-App, im Browser leider nicht.
  > Trainiere einfach normal weiter: Am Ende zeigt das Gerät einen QR-Code. Scanne ihn hier erneut,
  > dann werden deine Trainingsdaten übertragen.“
  Mit Button „Ok“ und optional „Erinnere mich“, dann bleibt der Scanner über einen Hinweis im laufenden Workout erreichbar.
- Vor dem Coden am echten Fahrrad prüfen: (1) beide QR-Codes (Verbindungsmenü **und** Ergebnis am Ende)
  mit der iPhone-Kamera scannen und die URLs notieren. Der Ergebnis-QR liefert gleich einen echten
  Testvektor. (2) mit nRF Connect nachsehen, welche Services das Gerät anbietet (FTMS + LF-Service = v3?).
  Davon hängt ab, ob v2 oder v1 überhaupt gebraucht werden.

### B1. Abhängigkeiten
- BLE: `@capacitor-community/bluetooth-le` (Capacitor-7-kompatible Version)
- QR: nativ das vorhandene `@capacitor-mlkit/barcode-scanning`; im Web/PWA das ebenfalls vorhandene
  `jsqr` mit Kamera über `getUserMedia` (HTTPS nötig, iOS-Safari unterstützt das). Prüfen, ob openGym
  dafür schon einen Scanner hat, z. B. für den Import oder das Teilen per QR (`lean-qr`/`jsqr` stehen in
  `frontend/package.json`), und ihn wiederverwenden. Fallback: ein Foto vom QR-Code hochladen und mit
  `jsqr` dekodieren.
- NFC (optional, in Phase 3): ein Capacitor-NFC-Plugin für NDEF-Lesen. iOS braucht dafür das
  CoreNFC-Entitlement und `NFCReaderUsageDescription`.
- iOS `Info.plist`: `NSBluetoothAlwaysUsageDescription`, `UIBackgroundModes` → `bluetooth-central`
  (damit die Verbindung bei gesperrtem Bildschirm bestehen bleibt). Android: Berechtigungen
  BLUETOOTH_SCAN/CONNECT und ein Foreground-Service (oder Wake-Lock/Screen-on) für die Workout-Dauer.

### B2. Neues Modul `frontend/src/lib/lfopen/` (reines JS, gut testbar)
- `qr.js`: `parseLfUrl(url)` → `{kind: 'ble'|'result'|'unsupported', a, u, l, x, online, isQa}` und
  `decodeResultQr(url)` → Ergebnis-JSON (Base64 aus `r`)
- `protocol.js`: UUID-Konstanten, `checksum()`, `splitChunks(data, mtu)`, `ChunkAssembler`
  (seq/total/checksum/„JSON schon in Chunk 0“), FTMS-Parser für Indoor Bike, Treadmill und Cross Trainer
  (Flags-Bitfeld nach FTMS-Spezifikation), Encoder für Level, Steigung, Watt und Zielpuls
- `session.js`: Zustandsautomat `IDLE → SCANNING → CONNECTING → DISCOVERING → LOGIN_START →
  LOGIN_CONFIRMED → SENDING_PROFILE → LOGGED_IN → STREAMING → SUMMARY → DONE | FAILED`.
  Writes laufen über eine **serielle Queue** (immer nur ein Write in Arbeit, wie bei LF). Watchdog-Timeouts
  aus A4, Fehlercodes nach dem LF-Schema
- `result.js`: Ergebnis-JSON in eine openGym-Cardio-Einheit umwandeln (Dauer, Distanz, kcal; der Rest
  in die Notiz). Ein Platzhalter-Ergebnis aus dem letzten Live-Wert, falls die Zusammenfassung fehlt
- `transport.js`: dünner Adapter auf `@capacitor-community/bluetooth-le` (scan, connect, requestMtu
  (nur Android, iOS verhandelt selbst), startNotifications, read, write). So bleibt `session.js` ohne Plugin testbar.

### B3. Ablauf in der App
1. **Kein neuer Button.** Es wird der **vorhandene QR-Scan-Button bzw. -Scanner von openGym**
   verwendet. Der Agent sucht im Repo die bestehende Scan-Stelle (Nutzung von
   `@capacitor-mlkit/barcode-scanning`/`jsqr`) und baut den Scan **generisch** um: ein zentraler
   Dispatcher `handleScannedCode(text, context)` mit registrierten Handlern (vorhandene Funktion,
   `lfopen`-Handler …). Der erste Handler, der den Inhalt erkennt, gewinnt. Bisheriges Verhalten bleibt
   unverändert. `context` enthält die laufende Session und die gerade ausgewählte Übung.
   Der Life-Fitness-Handler erkennt die URL über `parseLfUrl` (Domain `lfconnect`/`halo.fitness`, `t=c`).
2. **Übung zuordnen** (gilt für `kind=result` und `kind=ble`):
   - Gerät bestimmen: beim Ergebnis über `t` (Modell-ID), bei BLE über die letzten 3 Ziffern des
     Gerätenamens. Mapping Modell → openGym-Übung in `lfopen/devices.js`, angelehnt an
     `EXERCISE` in `D:\lifefitness\scripts\build_cardio_csv.py` (Upright Bike, Recumbent Bike, Laufband →
     `walking on treadmill`, Crosstrainer → `walk elliptical cross trainer`, Rudergerät …). Unbekannte
     Modelle führen zu einer Auswahlliste der Cardio-Übungen.
   - **Ist in der laufenden Session genau diese Übung ausgewählt** (z. B. Upright Bike): ohne Rückfrage
     nur die Session-Daten übernehmen, also einen Cardio-Satz an diese Übung hängen (Ergebnis) bzw. die
     Live-Verbindung an diese Übung binden (BLE).
   - **Sonst**: anbieten „Upright Bike zur laufenden Session hinzufügen und Daten übernehmen?“. Bei Ja
     wird die Übung angelegt und der Satz mit den Daten gleich befüllt.
   - **Keine laufende Session**: anbieten, eine zu starten (bzw. beim Ergebnis-QR das Tag-Workout zum
     Datum `dt` anzulegen), danach weiter wie oben.
3. `kind=result` (**alle Plattformen**): `r` Base64-dekodieren, JSON parsen (Format A3.4), dann Zuordnung
   wie in Schritt 2 und eine kurze Vorschau (Dauer, Strecke, kcal, Ø-Werte). Duplikatschutz: `id` (GUID)
   des Ergebnisses am Satz speichern; wird derselbe QR noch einmal gescannt, kommt der Hinweis
   „bereits übernommen“.
4. `kind=ble` und **kein BLE verfügbar** (PWA/Web): Meldung aus B0, keine Verbindung, keine Übung anlegen.
   `kind=ble` und **nativ**: Übung wie in Schritt 2 zuordnen, dann 10 s scannen, nach Name mit `a`/`u`
   filtern, Protokoll erkennen.
   Bei v3 Init + Login. Profil aus dem openGym-Profil (Gewicht, Größe, Alter, Einheit) oder leer, ohne HMAC.
5. Live-Ansicht bei der zugeordneten Übung: Geschwindigkeit, Strecke, Zeit, Watt, U/min, Puls, kcal,
   Level. Dazu Steuerelemente für Level, Steigung, Watt und Zielpuls, passend zum Gerätetyp.
6. Workout-Ende: Zusammenfassung empfangen, quittieren, Verbindung schließen. Die Daten landen direkt im
   Cardio-Satz der in Schritt 2 zugeordneten Übung (vorhandenes Datenmodell und Store wiederverwenden),
   mit kurzer Bestätigung bzw. Undo.

### B4. Robuster als LF (Verbindung halten)
- Bei unerwartetem Disconnect: bis zu 3 Reconnect-Versuche (Backoff 1/2/4 s) zum selben Gerät, danach
  Login erneut, Stream wieder abonnieren.
- Der letzte Live-Stand wird laufend lokal gespeichert. Kommt keine Zusammenfassung, wird daraus ein
  Ergebnis angeboten, markiert als „aus Live-Daten“. Zusätzlich auf den Ergebnis-QR hinweisen.
- Bildschirm wach halten bzw. Foreground-Service (Android), Hintergrundmodus Bluetooth (iOS).

### B5. Phasen
1. **Ergebnis-QR** (Web/PWA und nativ): Scanner, `qr.js`, `result.js`, speichern, Duplikatschutz,
   BLE-Hinweis für die PWA. Das ist ohne Bluetooth sofort nutzbar und lohnt sich deshalb als erstes Release.
2. LFopen v3 nativ: Verbinden, Login, Live-Stream, Zusammenfassung, speichern (nutzt `result.js` mit)
3. Steuerung: Level, Steigung, Watt, Zielpuls. Preset-Upload nur, wenn openGym Cardio-Programme hat (sonst eine leere Preset-Liste senden)
4. NFC-Einstieg; LFopen v2 (Wahoo) nur, wenn B0 zeigt, dass es gebraucht wird (Referenz `com/lf/ble/wahoo/WahooFlow.java`, ~1800 Zeilen)

## Verifikation
- Unit-Tests (vitest, im Repo vorhanden) für `qr.js`, `protocol.js` (Checksumme, Chunking,
  Zusammensetzen auch mit falscher Checksumme und JSON im ersten Chunk), FTMS-Parser mit
  aufgezeichneten Bytes, `session.js` mit einem Fake-Transport (Login-Sequenz, Timeouts, Disconnect, Reconnect)
- Ergebnis-QR: Testvektor aus dem echten Ergebnis-QR des Fahrrads (B0). Getestet werden: Dekodieren,
  Mapping, Duplikat-Erkennung, kaputtes Base64/JSON → Meldung „ungültiger QR-Code“, Verbindungs-QR bei
  `canUseBle=false` → BLE-Hinweis
- Dispatcher und Zuordnung: Bestehende QR-Funktionen von openGym laufen unverändert (Regressionstest).
  Upright Bike ist ausgewählt → nur ein Satz kommt dazu, keine Rückfrage. Andere Übung ist ausgewählt
  → Angebot, die Übung hinzuzufügen. Keine Session → Angebot, eine zu starten. Unbekanntes Modell → Auswahlliste
- Ende-zu-Ende in der **PWA auf dem iPhone**: Workout ohne App fahren, Ergebnis-QR scannen, Werte mit der
  Konsole vergleichen. Verbindungs-QR scannen: es muss die Hinweis-Meldung kommen
- Mit dem nRF-Connect-Log der echten Konsole Testvektoren erzeugen
- Ende-zu-Ende am Gerät: QR scannen, verbinden (unter 10 s), Level ändern und am Gerät prüfen,
  Bildschirm 5 min sperren und die Verbindung muss stehen, Workout beenden, Werte mit der Konsolenanzeige
  vergleichen, prüfen, dass der Eintrag im heutigen openGym-Workout liegt
- Fehlerfälle: Bluetooth aus, falscher QR-Code, Gerät belegt, Verbindung mitten im Workout trennen
  (Reconnect bzw. Ergebnis aus Live-Daten)

## Offene Punkte für den Umsetzer
- Einheit `u` bei Distanz und Höhe; genauer Inhalt der Geschlechts-, Sprach- und Einheiten-Writes
  (LoginFlow ~300–420 nachlesen)
- Ob die Konsole im Studio mit leerem Profil und ohne HMAC eingeloggt wird (laut Code ja, am Gerät prüfen)

---

## Stand der Umsetzung

**Phase 1 (Ergebnis-QR) ist umgesetzt**, dazu die reinen Bausteine für Phase 2:

| Datei | Inhalt |
|---|---|
| `frontend/src/lib/scan-dispatch.js` | `dispatchScan` / `handleScannedCode`: erster Handler, der den Code erkennt, gewinnt. Die Übungs-Sticker bleiben der letzte Handler und verhalten sich unverändert. |
| `frontend/src/lib/lfopen/qr.js` | `parseLfUrl` (result / ble / invalid / unsupported, QA-Flag), Base64 wie Androids `getQueryParameter` (ein `+` bleibt `+`), auch URL-safe. |
| `frontend/src/lib/lfopen/result.js` | `normalizeResult` (alle Felder aus A3.4), `cardioSetFromResult` (min, km/h, Steigung beim Laufband, Rest in die Satz-Notiz), `resultKey`/`findResult` (Duplikatschutz über `set.lf`), `parseLfDate`. |
| `frontend/src/lib/lfopen/devices.js` | Modell-ID → Gerätefamilie (komplette Tabelle aus `ed/b0.java`) → openGym-Übung: zuerst eine eigene Übung mit passendem Namen („Upright Bike“ aus dem früheren Import), sonst der Katalog. |
| `frontend/src/lib/lfopen/assign.js` | `placeResult` (aktuelle Übung / weiter unten / nicht im Training), `applyResultSet` (füllt den offenen geplanten Satz, sonst neuer Satz). |
| `frontend/src/lib/lfopen/protocol.js` | Phase 2: UUIDs, Checksumme, `splitChunks`, `ChunkAssembler`, FTMS-Parser (Indoor Bike, Treadmill, Cross Trainer), Encoder für Level/Steigung/Watt/Zielpuls, `protocolOf`, `matchesDevice`. |
| `frontend/src/views/Workout.jsx` | Scan-Button → Dispatcher → LF-Handler; Verbindungs-QR zeigt den Hinweis aus B0. |

Offene Punkte aus dem Plan, beantwortet:
- **Einheit `u`**: `1` = metrisch (km, km/h, m), alles andere imperial (mi, mph, ft). LFconnect rechnet genau
  so (`distanceUnit == 1` → × 1000 m, sonst × 1609,34 m). Bei Stepper/PowerMill (Modelle 44/45/60–63)
  ist `dc` mit `u == 1` Stufen, sonst Etagen (17 Stufen je Etage). `am` ist METs × 10.
- Chunk-Header: `seq` und `total` sind **Big-Endian** (`extractValueFromBytes(..., false)`), die Checksumme
  ist die Bytesumme der Nutzlast mod 256.

Noch offen (Phase 2–4): `session.js` (Zustandsautomat mit Fake-Transport), `transport.js` auf
`@capacitor-community/bluetooth-le` (neue Abhängigkeit, iOS/Android-Berechtigungen), Live-Ansicht und
Steuerung, Reconnect, NFC. Der Fall „keine laufende Session“ ist noch nicht erreichbar, weil der Scanner
nur im laufenden Training sitzt. Ein Testvektor vom echten Gerät (B0) fehlt noch: Die Tests nutzen
selbst gebaute Codes im Format aus dem APK.
