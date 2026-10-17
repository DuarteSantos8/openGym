# Plan: Waagen-QR-Messungsimport in OpenGym nachbauen

## Context

Im aiFitness-Studio zeigt eine Körperanalyse-Waage (BIA, eGym/InBody-Familie) nach der
Messung einen **QR-Code** an. Die App `de.aiFitness` (APK `de.aiFitness_3.25.45.0.apk`,
interner Package-Name `de.liftandsquat`, White-Label-Plattform "ConnectedGym" / iconiq)
scannt diesen Code und überträgt die Messung aufs Handy.

Ziel dieses Plans: die Funktion so dokumentieren, dass ein **nachgelagerter Agent** sie in
**OpenGym** (separates Repo, dem Agenten bekannt) nachbauen kann. Dieser Plan ist eine
**Protokoll-/Format-Spezifikation** (keine Backend-Vorgaben), beschränkt auf den
**reinen Waage-QR-Import** (Scan → Messung erfassen → anzeigen; **ohne** eGym-RFID-Login).

Die Analyse erfolgte durch Dekompilieren der APK mit `jadx` (Quelle: `classes*.dex`).

---

## Kernerkenntnis (entscheidend für die Umsetzung)

**Die App ist ein reiner Weiterleiter ("dumb forwarder").** Sie interpretiert die einzelnen
Messwerte NICHT clientseitig. Sie prüft nur, dass der QR-Inhalt ein Zahlen-Array einer
bestimmten Länge ist, und schickt die rohen Floats als JSON an den Server. Die Zuordnung
**Array-Position → benanntes Körperwert-Feld** (Gewicht, Fettmasse, Muskelmasse, segmentale
Werte …) passiert **serverseitig** bei ConnectedGym/iconiq.

→ Konsequenz für OpenGym: Das **Index→Feld-Mapping für die Längen 63/64/95 ist aus der APK
nicht ableitbar**. Es muss aus **echten Beispiel-QR-Strings** der konkreten Waage
rekonstruiert werden.

**Status:** Für das **64-Werte-Format** liegt bereits ein dekodiertes Beispiel vor; 21 der 64
Positionen sind gegen die App-Anzeige **verifiziert** (siehe **Anhang A**). Die restlichen
Positionen sowie die Formate mit **63** und **95** Werten brauchen weitere Samples.

---

## Protokoll-Spezifikation (aus der APK verifiziert)

### 1. QR-Scan
- Scanner: Google **ML Kit barcode-scanning 17.3.0**, QR_CODE.
- Scanner-Screen: `de.liftandsquat.VisionActivity` (+ internes Fragment). Liefert per
  `onActivityResult` (requestCode **239**) zurück:
  - `VISION_RESULT_CODE` (String): der rohe gescannte Text
  - `VISION_RESULT_IS_QR` (boolean)

### 2. QR-Dispatcher
- Klasse `jn.i` (`VisionManager`), Methode `s(...)`. Probiert Handler der Reihe nach:
  Workout-new → Workout → Exercise → JSON-QR-Modell (`cl.c`: Check-in/Coupon/Locker/…) →
  **Bodycheck (Waage)** → Membership/Shop/Padel-URLs.
- Der Waage-Zweig ist `jn.i.i(...)`:
  - ruft `float[] arr = uk.f.c(gson, scannedString)` (Parser, siehe unten)
  - wenn `arr == null || leer` → kein Bodycheck, nächster Handler
  - Gate: nur wenn `SubProjectSettings.enableBodycheck == true`, sonst Meldung
    "no bodycheck permitted"
  - sonst → Import (unten). (Der eGym-Abzweig in `jn.i.h(...)` ist **out of scope**.)

### 3. QR-Payload-Format (Parser `uk.f.c(gson, str)`)
Exakte Regeln aus dem Code:
1. String muss mit `[` beginnen und mit `]` enden.
2. Klammern entfernen, an `,` splitten.
3. **Anzahl der Elemente muss exakt 63, 64 oder 95 sein** — sonst `null` (ungültig).
   (Die drei Längen entsprechen drei Geräte-/Messvarianten.)
4. Jedes Element via `Float.parseFloat` parsen; schlägt eines fehl → `null`.
5. Ergebnis: `float[]` in Originalreihenfolge.

Beispielschema des QR-Inhalts: `[72.3,18.4,56.1,...]` (63/64/95 Kommazahlen).

### 4. Import-Request (Server-Contract)
- Retrofit-Interface `de.liftandsquat.core.api.interfaces.HealthApi`.
- **`POST api/bodyscale/qr-import`**, Body = `apiUtils.i(float[])` =
  **Gson-JSON des Float-Arrays** (`[72.3,18.4,...]`), Content-Type `application/json`.
- Ausgelöst über `BodycheckJob` (`core.jobs.profile.k`, Modus `l0(1)` + `n0(float[])`).
- Base-URL (Prod): **`https://iq-rest-api-aifit.iconiq-solutions.com`**
  (`BuildConfigLibraries.BASE_URL`; Dev/Alt: `*.connectedgym.incubation.io`).
- Auth: Bearer-/Token-Header, verwaltet von `AuthService` (projekt-/nutzergebunden).

### 5. Response & Anzeige
- Antwort = **Bodycheck**-Objekt (`uk.f`), serverseitig bereits in benannte Felder gemappt.
- Relevante Felder (Auszug, `select`-Liste aus `BodycheckJob`):
  `weight, free_fat_mass, fm_fat_mass, percentage_body_fat, skeletal_muscle_mass,
  total_body_water, health_score, lean_mass, protein_mass, bacal_metabolic_rate,
  body_mass_index, muscle_mass_assessment, biological_age, smm_standardization,
  user_height, body_type_analysis_axis_x/_y`, segmentale Werte
  `{left,right}_{arm,leg}_lean_mass / _fat_mass`, `trunk_lean_mass/trunk_fat_mass`,
  Radar-Werte `*FatMassRadar`, Normbereiche `fat_mass/protein/ecw_normal_range_*`,
  `icw_range_lower/upper`.
  (Feldbenennung = **InBody/eGym-BIA-Terminologie** → Gerätefamilie.)
- Neueste Messung laden: **`GET api/bodyscale?sort=-created&limit=1&select=<felder>`**.

### 6. eGym-Variante (nur zur Einordnung, NICHT umsetzen)
Bei eGym-Projekten zeigt die App vor dem Import einen RFID-Dialog
(`ui.dialog.m`, Default-Format `MIFARE`) und ruft `POST api/egym/login` mit Body
`{"rfid":"<wert>","rfidFormat":"MIFARE"}`, danach denselben `qr-import`. Für OpenGym
ausgeklammert.

---

## Umsetzungsplan für OpenGym (stack-agnostisch)

Da OpenGym in einem separaten Repo lebt, beschreibt der Plan Komponenten und
Integrationspunkte; der nachgelagerte Agent setzt sie im OpenGym-Stack um.

**Schritt 1 — Index→Feld-Mapping (für 64-Format größtenteils erledigt).**
- Das 64-Werte-Mapping ist in **Anhang A** dokumentiert (21 Felder verifiziert). OpenGym kann
  damit die Kernwerte (Gewicht, KFA, Muskelmasse, BMI, Grundumsatz, Wasser, biol. Alter,
  Größe, alle 10 segmentalen Werte) direkt interpretieren.
- Für die restlichen 64er-Positionen und für die **63er-/95er-Formate**: je ein weiteres
  Sample mit *abweichenden* Werten (anderer Messung/Person) erfassen und gegen die
  App-Anzeige abgleichen, um die offenen Positionen zu triangulieren.
- Methode zum Dekodieren eines Foto-QR: `pyzbar`/OpenCV mit Upscaling/CLAHE/Adaptive-Threshold
  (siehe `scratchpad/scripts/qr_decode.py` dieser Session als Vorlage).

**Schritt 2 — QR-Scanner.**
- QR-Scan-Komponente im OpenGym-Stack (Web: `html5-qrcode`/`BarcodeDetector`;
  Android: ML Kit). Nur QR_CODE nötig. Ergebnis: roher String.

**Schritt 3 — Validierung/Parser** (Portierung von `uk.f.c`):
- Regex `^\[.*\]$`, Klammern strippen, an `,` splitten, Länge ∈ {63,64,95} prüfen,
  jedes Element als Float parsen, bei Fehler komplett verwerfen (identische Semantik).

**Schritt 4 — Mapping + Persistenz** (ersetzt den iconiq-Server):
- Float-Array per Index→Feld-Tabelle (Schritt 1) in ein OpenGym-Messmodell überführen
  (Felder siehe Abschnitt 5) und einem Nutzer/Datum zuordnen.
- Feature-Gate analog `enableBodycheck` vorsehen.

**Schritt 5 — Anzeige.**
- Neueste/historische Messungen anzeigen (Analog zu `GET api/bodyscale?sort=-created`),
  Kernwerte + optional segmentale/Radar-Darstellung.

**Hinweis Altitude:** `enableBodycheck`-Gate, Fehlermeldungen und UI-Flow möglichst an das
bestehende OpenGym-Pattern anlehnen, nicht 1:1 die Android-Jobstruktur übernehmen.

---

## Verifikation
1. **Format-Tests:** Parser gegen (a) echten Beispiel-QR (gültig), (b) falsche Länge,
   (c) nicht-numerisches Element, (d) ohne Klammern → nur (a) ergibt ein Array.
2. **Mapping-Test:** Beispiel-QR → Mapping → erwartete Klartextwerte der Waage (Schritt 1)
   müssen übereinstimmen (Gewicht/KFA/Muskelmasse als Ankerpunkte).
3. **End-to-End:** QR scannen → Messung erscheint beim richtigen Nutzer mit korrekten Werten.
4. **Negativfall:** fremder/ungültiger QR → saubere Ablehnung ("Invalid QR code").

---

## Quellen / Evidence (für Nachvollziehbarkeit)
APK `de.aiFitness_3.25.45.0.apk`, dekompiliert mit jadx. Relevante Klassen:
- Parser/Modell: `uk.f` (`Bodycheck`), Methode `c(...)` — QR-Format + Längen 63/64/95
- Dispatcher: `jn.i` (`VisionManager`) — `s(...)`, Waage-Zweig `i(...)`, `h(...)`
- Scanner: `de.liftandsquat.VisionActivity` — `VISION_RESULT_CODE` / `_IS_QR`, rc 239
- Import-Job: `de.liftandsquat.core.jobs.profile.k` (`BodycheckJob`), Modus 1
- API: `de.liftandsquat.core.api.interfaces.HealthApi` — `POST api/bodyscale/qr-import`,
  `GET api/bodyscale?sort=-created&limit=1`
- Request-Body-Builder: `uj.c.i(Object)` (Gson→JSON RequestBody)
- eGym-Login (out of scope): `ck.c` (`{rfid, rfidFormat}`), `ui.dialog.m`, `api/egym/login`
- Config: `de.liftandsquat.core.BuildConfigLibraries.BASE_URL`
- Gate: `SubProjectSettings.enableBodycheck`

> Hinweis: Die dekompilierten Quellen liegen in einem temporären Scratchpad-Ordner dieser
> Session und sind nicht dauerhaft. Bei Bedarf APK erneut mit jadx dekompilieren.

---

## Anhang A — Dekodiertes Beispiel (64-Werte-Format)

Quelle: Foto des Waagen-Kiosks ("MESSERGEBNISSE / Bitte scanne jetzt den QR Code mit deiner
Studio APP") + zugehörige App-Screenshots ("Körperdaten", Messung 03.01.26). QR mit `pyzbar`
dekodiert. Gerät = segmentale BIA-Waage (eGym/InBody-Familie, 8-Punkt-Elektroden).

**Roher QR-Inhalt (Länge 64):**

```
[87.0,64.3,22.7,26.1,36.2,46.9,76.5,1.4,1.3,1.3,0.0,0.1,1.8,1.8,1.8,1.5,1.5,2.2,2.4,3.9,4.0,29.6,9.2,9.0,1.1,1.1,13.5,2.9,2.8,43.0,8.0,4.1,29.7,17.2,13.3,1758.0,30.1,73.8,138.4,240.0,121.0,-13.2,-13.2,0.0,67.4,0.95,170.0,8.7,17.4,2.8,4.9,11.0,15.2,13.6,16.6,22.2,27.1,19.8,34.1,4.7,15.2,40.0,4.0,4.0]
```

### A.1 Verifizierte Positionen (21) — gegen App-Anzeige bestätigt

| Idx | Wert | Feld (uk.f / App) |
|----|------|-------------------|
| 0  | 87.0 | `weight` — Gewicht (kg) |
| 1  | 64.3 | `free_fat_mass` / `lean_mass` — Magermasse (kg) |
| 2  | 22.7 | `fm_fat_mass` — Körperfett (kg) |
| 3  | 26.1 | `percentage_body_fat` — Körperfettanteil (%) |
| 4  | 36.2 | `skeletal_muscle_mass` — Muskelmasse (kg) |
| 5  | 46.9 | `total_body_water` — Körperwasser (L); 46.9/87.0 = 53.9 % ✓ |
| 19 | 3.9  | `right_arm_lean_mass` — Magermasse rechter Arm |
| 20 | 4.0  | `left_arm_lean_mass` — Magermasse linker Arm |
| 21 | 29.6 | `trunk_lean_mass` — Magermasse Torso |
| 22 | 9.2  | `right_leg_lean_mass` — Magermasse rechtes Bein |
| 23 | 9.0  | `left_leg_lean_mass` — Magermasse linkes Bein |
| 24 | 1.1  | `right_arm_fat_mass` — Fett rechter Arm |
| 25 | 1.1  | `left_arm_fat_mass` — Fett linker Arm |
| 26 | 13.5 | `trunk_fat_mass` — Fett Torso |
| 27 | 2.9  | `right_leg_fat_mass` — Fett rechtes Bein |
| 28 | 2.8  | `left_leg_fat_mass` — Fett linkes Bein |
| 34 | 13.3 | `protein_mass` — Muskelprotein (kg) |
| 35 | 1758.0 | `bacal_metabolic_rate` — Grundumsatz (kcal) |
| 36 | 30.1 | `body_mass_index` — BMI |
| 46 | 170.0 | `user_height` — Körpergröße (cm) |
| 61 | 40.0 | `biological_age` — Biologisches Alter |

Konsistenz-Checks: Gewicht − Fett = 87.0 − 22.7 = 64.3 = Magermasse ✓; Σ segmentales Fett
(1.1+1.1+13.5+2.9+2.8 = 21.4) ≈ Körperfett 22.7 ✓; Wasseranteil 46.9/87.0 = 53.9 % ✓.

### A.2 Noch unbestätigte Positionen (Hypothesen) — zweites Sample nötig

| Idx (Wert) | Hypothese (unbestätigt) |
|-----------|-------------------------|
| 6 (76.5) | `health_score` (Score 0–100) |
| 7–18 (1.4,1.3,1.3,0.0,0.1,1.8,1.8,1.8,1.5,1.5,2.2,2.4) | segmentale ECW/ICW- oder Impedanzwerte bzw. `*FatMassRadar` |
| 29–33 (43.0,8.0,4.1,29.7,17.2) | u. a. viszerales Fett / SMM-Standardisierung |
| 37–40 (73.8,138.4,240.0,121.0) | Impedanz-/Reaktanzwerte (Ω) |
| 41,42 (−13.2,−13.2) | `body_type_analysis_axis_x` / `_y` (können negativ sein) |
| 44,45 (67.4,0.95) | Prozent-/Verhältniswert (z. B. WHR) |
| 47–60 (8.7,17.4,2.8,4.9,11.0,15.2,13.6,16.6,22.2,27.1,19.8,34.1,4.7,15.2) | Normbereichs-Grenzen (lower/upper-Paare): `fat_mass_/protein_/ecw_normal_range_*`, `icw_range_*` |
| 62,63 (4.0,4.0) | offen |

> Diese Hypothesen NICHT ungeprüft übernehmen. Ein zweites Sample (andere Messwerte) macht die
> offenen Positionen eindeutig, da sich dann konstante von variablen Werten trennen lassen.

### A.3 Hinweise für OpenGym
- Nur die verifizierten 21 Positionen für die Anzeige verwenden; Rest als "roh/unmapped"
  speichern, bis bestätigt.
- Dieses Mapping gilt **ausschließlich für Länge 64**. Länge 63 und 95 sind separate Layouts.
- Einheiten: Massen in kg, Wasser in L, Größe in cm, Grundumsatz in kcal, Alter in Jahren.

---

## Stand der Umsetzung (openGym, Branch `feature/aibodycheck`)

Umgesetzt ohne neue Abhängigkeit und ohne Server-Änderung; der Scan läuft offline im Browser,
in der PWA und in den Capacitor-Apps (derselbe Scanner wie Check-in und Übungs-QR-Codes).

| Plan-Schritt | Umsetzung |
|---|---|
| 2 — QR-Scanner | `scanOnce()` (components/CameraScan.jsx). Einstiege: QR-Button im Kopf von **Körpermaße** und der QR-Button im laufenden Training; dort geht ein Waagen-Code an den Import statt als Übungs-Code angeboten zu werden. |
| 3 — Parser | `parseScaleQr()` in `frontend/src/lib/bodyscan.js`: `[` … `]`, genau 63/64/95 Elemente, jedes wie `Float.parseFloat` (Leerraum, Vorzeichen, Exponent, `f`/`d`-Suffix); ein ungültiges Element verwirft den ganzen Code. Abweichung: `NaN`/`Infinity`/Hex werden abgelehnt, weil gespeicherte Werte echte Zahlen sein müssen. |
| 4 — Mapping + Persistenz | `LAYOUTS[64]` mit den 21 verifizierten Positionen aus A.1, sonst nichts. Gespeichert wird immer das **rohe Array** (`scan: { len, v }`) am Körpermaß-Eintrag des Tages — der synct und merged bereits pro Tag, also kein neues State-Feld und keine Sync-Änderung. Zusätzlich: Körperfett-% → Messwert `bodyFat`, Gewicht → Wiegen des Tages (in kg/lb des Profils, abschaltbar). Ein zweiter Scan am selben Tag ersetzt den ersten, wie ein zweites Wiegen. `lib/bodyscan-import.js`. |
| 5 — Anzeige | Vorschau-Sheet vor dem Speichern (Kernwerte als Kacheln, Segment-Tabelle mager/fett, Hinweis was ersetzt wird); Karte **Körperanalyse** in Körpermaße mit der neuesten Messung; Muskelmasse, Fettmasse, Magermasse, Wasser, Protein, Grundumsatz, biologisches Alter als eigene Verläufe im Diagramm; Verlaufseintrag zeigt „Körperanalyse“. Massen in kg oder lb je Profil, Größe in cm/in. |
| Gate `enableBodycheck` | Bewusst **nicht** umgesetzt: Es gibt keinen Server, der etwas erlauben müsste, und das strikte Format (Klammern + exakte Länge + nur Zahlen) erkennt keinen anderen Code fälschlich als Waage. |

**63/95-Formate:** werden gespeichert, aber nicht gelesen; Karte und Vorschau sagen das. Sobald
ein Layout in `LAYOUTS` nachgetragen ist, zeigen auch die schon gespeicherten Scans ihre Werte.

**Tests:** `lib/bodyscan.test.js` (Verifikation 1 + 2 + 4 des Plans: gültig, falsche Länge,
nicht-numerisch, ohne Klammern, fremde Codes; Anhang-A-Sample → erwartete Klartextwerte und
Konsistenz Gewicht − Fett = Mager), `lib/bodyscan-import.test.js` (Persistenz, lb-Profil,
Ersetzen, unbekanntes Layout, Diagramm-Reihen, Zusammenführen zweier Einträge eines Tages),
`views/BodyScan.test.jsx` (Sheet, Speichern/Abbrechen, Wiegen abschalten, Fremd-Code),
`views/Workout.test.jsx` (Waagen-Code im Training öffnet den Import, wird keiner Übung zugeordnet).

**Offen:**
- Zweites 64er-Sample, um die 43 unbestätigten Positionen (A.2) zu klären — dann z. B.
  Health-Score, viszerales Fett, Normbereiche, Körpertyp-Achsen.
- Samples für die 63er- und 95er-Waagen.
- Ende-zu-Ende-Test mit einem echten Waagen-QR auf dem Handy (Verifikation 3).
