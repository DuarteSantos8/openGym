# Third-party notices

openGym — Copyright (C) 2026 Duarte Santos.
openGym's own code is licensed under the **GNU AGPL v3.0** (see [LICENSE](LICENSE)).

## App store exception

As an additional permission under section 7 of the AGPL v3.0, the copyright holder permits
distribution of the openGym mobile application through app store platforms (such as the
Apple App Store and Google Play) whose terms of service would otherwise be incompatible
with the AGPL, provided the corresponding source code remains available under the AGPL at
the project repository. This permission applies to the distribution channel only and does
not otherwise limit the license.

## Body diagram geometry

The muscle outlines the body maps are drawn from (`frontend/src/lib/body-paths.js`) are derived
from [**MuscleMap**](https://github.com/melihcolpan/MuscleMap) by Melih Colpan, used under the
**MIT License** and reproduced below. MuscleMap ships its path data as Swift source rather than
`.svg` files; the paths were converted to a JSON module, its sub-group shapes were dropped, and
nothing else about the artwork was changed.

```
MIT License

Copyright (c) 2026 Melih Colpan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Exercise data & media

openGym obtains both through
[**hasaneyldrm/exercises-dataset**](https://github.com/hasaneyldrm/exercises-dataset), which
licenses them differently. Neither is covered by openGym's AGPL license.

That dataset is itself a redistribution: the content originates from
[**ExerciseDB v1**](https://exercisedb.dev/) by **AscendAPI**. This is verifiable from openGym's
own data — the stored media filenames embed ExerciseDB's `exerciseId` (openGym's `0001` is
`0001-2gPfomN.jpg`; `2gPfomN` is ExerciseDB's id for "3/4 sit-up"), every metadata field matches,
and the instruction sentences are identical apart from stripped `Step:N ` prefixes. See
[issue #5](https://github.com/hasaneyldrm/exercises-dataset/issues/5) on that dataset.

### Metadata & instruction text

The exercise names, attributes and instructions (English in `frontend/src/lib/exercises-data.js`,
other languages in `frontend/src/instr/`, regenerated via `scripts/build-instructions.mjs`)
originate from ExerciseDB v1 and reach openGym through the dataset above, which distributes them
under the MIT license reproduced below. The translations into languages other than English are
openGym's own derivative work and are covered by openGym's AGPL.

```
MIT License

Copyright (c) 2026 Hasan Emir Yıldırım

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation and data files (the "Software"),
to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Images & animations — third-party, not MIT and not AGPL

The exercise thumbnails (180×180) and animations are **not** covered by the MIT license above and
**not** by openGym's AGPL. Their ownership is currently **unresolved**, and openGym states this
plainly rather than guessing:

- The upstream dataset attributes them to **© [Gym visual](https://gymvisual.com/)**, redistributed
  there with that rights holder's written permission — a permission granted to *that dataset* and
  **not transferable**.
- **ExerciseDB/AscendAPI** describes itself as "the original creator and owner" of this content and
  publishes its own [terms](https://exercisedb.io/faq), which permit self-hosting, bundling and
  commercial display, while prohibiting redistribution of the raw dataset or media as a standalone
  or competing content package.

These two claims contradict each other. A clarification has been requested from AscendAPI; this
notice will be updated once the provenance is settled.

**Until then, treat the media as third-party content licensed to neither openGym nor to you.**

**openGym does not redistribute it.** It is not in this repository, not in its history, and not in
the published container images or the Android APK. A self-hosted instance downloads it from the
upstream source on first `docker compose up`; the mobile and demo builds load it from a CDN at
runtime.

If you want to reuse the media — in openGym or anywhere else, commercially or not — **clear it with
the rights holder first**, and keep any attribution that accompanies it intact.

Brazilian Portuguese exercise instructions under
`scripts/instruction-sources/pt-BR.json` and exercise names under
`scripts/exercise-name-sources/pt-BR.json` are original translations of that
English source produced with OpenAI Codex and Anthropic Claude Code
language-model assistance. They are not copied from a separate Portuguese
dataset. Their review status and translation policy are documented alongside
the source files.

## Gym check-in QR codes

The gym check-in feature (a saved membership code shown as a QR code on the phone, added by
typing, importing a photo, or scanning with the camera) uses three third-party packages. All are
permissively licensed and compatible with openGym's AGPL, and all load on demand: the QR renderer
and the browser decoder only when a card is shown or scanned, the ML Kit plugin only in the
Android/iOS app.

### QR/barcode rendering — `lean-qr`

openGym renders each saved code on the phone with [**lean-qr**](https://github.com/davidje13/lean-qr)
by David Evans, used under the **MIT License** and reproduced below. Only the code's stored value
is kept; the picture is generated fresh from that value each time it is shown, never stored.
It runs the same way in the app and in the browser/PWA.

```
MIT License

Copyright (c) 2021-2025 David Evans

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Camera scan & photo decode in the browser — `jsQR`

In a browser (including the installed PWA), reading a code from the camera or from an imported
photo uses [**jsQR**](https://github.com/cozmo/jsQR) by Cosmo Wolfe, under the **Apache License
2.0** (text at <https://www.apache.org/licenses/LICENSE-2.0> and in the package's own `LICENSE`).
Where the browser has a native `BarcodeDetector`, that is tried first and jsQR is the fallback.
Video frames are decoded in memory and never uploaded or stored.

### Camera scan & photo decode in the app — `@capacitor-mlkit/barcode-scanning`

In the Android/iOS app, reading a code — from the camera or from an imported photo — uses the
[**@capacitor-mlkit/barcode-scanning**](https://github.com/capawesome-team/capacitor-mlkit) plugin
by the Capawesome Team (Robin Genz), a Capacitor wrapper around Google's ML Kit, used under the
**Apache License 2.0**. openGym pins the `7.x` line to stay on Capacitor 7. The full license text is
available at <https://www.apache.org/licenses/LICENSE-2.0> and in the package's own `LICENSE` file.
The decoded string is what openGym keeps; the photo itself is never stored.
