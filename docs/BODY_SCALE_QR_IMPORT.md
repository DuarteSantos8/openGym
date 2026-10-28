# Body-composition scales: the QR code

A segmental BIA scale of the kind found in gyms (eGym/InBody family, 8 electrodes) shows a QR
code after a measurement. openGym reads it offline, with the scanner it already has, and keeps
the measurement on the day's check-in.

## The format

The code is nothing but numbers:

```
[78.4,60.5,17.9,22.8,33.1,44.6,81.0,1.2,...]
```

- `[` … `]` around comma-separated numbers.
- Exactly **63, 64 or 95** of them, one length per scale model. Any other count is not a scale
  code.
- Each element parses like Java's `Float.parseFloat` (surrounding whitespace, a sign, a decimal
  point, an exponent and a trailing `f`/`d` are fine). One element that does not parse rejects
  the whole code. openGym also rejects `NaN`, `Infinity` and hex, since a saved scan must hold
  real numbers.

There are no field names in the code: what a position means depends on the length, and has to
be read against what the scale showed for the same measurement.

## The 64-value layout

Known from one measurement whose QR content was compared value by value with the results shown
for it. 21 positions are confirmed:

| Index | Field | Unit |
|---|---|---|
| 0 | weight | kg |
| 1 | lean mass (fat-free mass) | kg |
| 2 | fat mass | kg |
| 3 | body fat | % |
| 4 | skeletal muscle mass | kg |
| 5 | total body water | L |
| 19 | right arm, lean mass | kg |
| 20 | left arm, lean mass | kg |
| 21 | trunk, lean mass | kg |
| 22 | right leg, lean mass | kg |
| 23 | left leg, lean mass | kg |
| 24 | right arm, fat mass | kg |
| 25 | left arm, fat mass | kg |
| 26 | trunk, fat mass | kg |
| 27 | right leg, fat mass | kg |
| 28 | left leg, fat mass | kg |
| 34 | protein | kg |
| 35 | basal metabolic rate | kcal |
| 36 | BMI | |
| 46 | height | cm |
| 61 | biological age | years |

A sample in this layout (64 values; the numbers are made up, the positions are the confirmed ones):

```
[78.4,60.5,17.9,22.8,33.1,44.6,81.0,1.2,1.1,1.2,0.0,0.1,1.6,1.7,1.6,1.4,1.3,2.0,2.1,3.4,3.3,27.4,8.6,8.5,0.9,1.0,10.6,2.4,2.3,39.0,7.0,3.6,26.9,15.8,12.4,1690.0,25.3,69.2,131.0,228.0,117.0,-9.8,-9.8,0.0,63.1,0.91,176.0,7.9,15.8,2.6,4.5,10.2,14.1,12.6,15.4,20.5,25.0,18.3,31.6,4.3,14.0,34.0,4.0,4.0]
```

On a real measurement the values agree with each other: weight − fat mass = lean mass, the
segments' fat is close to the total, and water is about half the weight. The made-up sample
keeps that (78.4 − 17.9 = 60.5; 0.9 + 1.0 + 10.6 + 2.4 + 2.3 = 17.2 ≈ 17.9; 44.6 / 78.4 = 56.9 %).

The other 43 positions are not used. They likely include a health score, segmental water or
impedance values, body-type axes and the bounds of the normal ranges, but one sample cannot tell
constants from measurements: a second one with different values can. The 63- and 95-value
layouts are unknown.

## In openGym

| | |
|---|---|
| Parser and layout | `frontend/src/lib/bodyscan.js`: `parseScaleQr`, `LAYOUTS[64]` with the 21 positions above and nothing else. |
| Saving | `frontend/src/lib/bodyscan-import.js`: the **raw array** is kept as `scan: { len, v }` on the day's body-measurement entry, which already syncs and merges per day. Body fat % also fills the Body fat measurement, the weight becomes the day's weigh-in (in the profile's kg or lb, can be switched off). A second scan on the same day replaces the first. |
| Scanning | The QR button on **Body measurements**, in **Stats → Body data**, on the Home screen's weight card, and in a running workout (a scale code goes to the import, not to an exercise). |
| Display | A preview before saving; the latest scan on Body measurements; muscle mass, fat mass, lean mass, water, protein, BMR and biological age as their own chart lines; **Stats → Body data** with the change since the previous scan and the segment analysis around the body figure (lean mass or fat). |

A 63- or 95-value scan is saved but not read; the card says so. Once its layout is added to
`LAYOUTS`, the scans already saved show their values.

Not shown: the normal-range bars and ratings some gym apps draw. Their bounds are not among the
confirmed positions.

## Open

- A second 64-value sample, to place the remaining positions.
- Samples from 63- and 95-value scales.
- An end-to-end test with a real scale code on a phone.
