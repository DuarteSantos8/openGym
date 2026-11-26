# Rebuilding frontend/public/anatomy/muscles.glb

1. Download `Z-Anatomy.zip` from https://github.com/Z-Anatomy/Models-of-human-anatomy and unzip it
   (SHA-256 of the zip used: `E029688545627BD0214B269E1063143ABB580AAD72B2C2445D6D8A9A0D9DA736`).
2. `blender --background --factory-startup Z-Anatomy/Startup.blend --python build_muscles.py -- muscles-raw.glb build-report.json`
   (Blender 5.3; the mapping from openGym muscle ids to anatomical names is the `RULES` table at the top).
3. `npx @gltf-transform/cli optimize muscles-raw.glb muscles.glb --compress meshopt --texture-compress false --simplify false --join false --instance false --palette false --flatten false`
4. Check: `blender --background --factory-startup --python render_check.py -- muscles-raw.glb <abs-path-prefix>` renders
   front and back with one colour per group; `frontend/src/lib/muscle-3d.test.js` checks every muscle id has a mesh.
5. Licence: CC BY-SA 4.0, see `frontend/public/anatomy/ATTRIBUTION.md`.
