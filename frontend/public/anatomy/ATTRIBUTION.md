# muscles.glb: attribution and licence

`muscles.glb` is a **simplified adaptation** of the muscular system of **Z-Anatomy**, which is
itself built on **BodyParts3D**.

- Z-Anatomy, the libre 3D atlas of anatomy, CC BY-SA 4.0: https://github.com/Z-Anatomy/Models-of-human-anatomy
- BodyParts3D, © The Database Center for Life Science, CC BY-SA 2.1 Japan: https://lifesciencedb.jp/bp3d/

## Changes made for openGym (2026-11-14)
- Source: `Z-Anatomy.zip` (SHA-256 `E029688545627BD0214B269E1063143ABB580AAD72B2C2445D6D8A9A0D9DA736`), `Startup.blend`, collection "4: Muscular system".
- Muscles grouped into openGym's 21 muscle groups (one mesh each; left and right joined); every other muscle joined into one neutral `body` mesh. Fascia, tendons, aponeuroses and small internal head muscles left out.
- Decimated from 1.83 M to 96.6 k faces (≈3,500 per group, ≈23,000 for `body`), then quantized and meshopt-compressed (glTF-Transform 4.5.1).
- Output SHA-256: `298d54f7a2962d21c6523496f177fd0db5922e17c46aa6fcbbf28984ab6a69c1`. Build scripts: `docs/next/anatomy/`.

## Licence
This adapted model is licensed **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/).
It is a separate work from openGym's AGPL-3.0 code; the app shows this attribution beside the model.
