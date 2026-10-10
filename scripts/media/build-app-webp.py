#!/usr/bin/env python3
"""The Android app's exercise animations as animated WebP (240 px, lossy q60), from the 360 px
GIFs of the licensed Gym visual pack. Maintainer only, against the private archive:

    python3 -I scripts/media/build-app-webp.py /path/to/opengym-media [--jobs 3]

Writes <archive>/build-appwebp/<id>.webp. Why images and not the MP4 loops the web uses: in the
app's WebView a <video> goes through the phone's hardware decoder, which stalled at every loop
of these 3-second clips (users: "slow and buggy"); an animated image is decoded like the GIFs the
app showed before and loops on its own. 240 px keeps the package at the size of the 360 px MP4s.
The media are only ever re-encoded by ffmpeg here (licence: no AI on the media).
"""
import io, json, os, subprocess, sys, tempfile, zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed

PX, Q = 240, 60

def encode(job):
    root, row = job
    out = os.path.join(root, 'build-appwebp', row['gv'] + '.webp')
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return row['gv'], 'skip'
    files = row['files']
    src = files.get('360') or files.get('720') or files.get('1080')
    if not src:
        return row['gv'], 'no-source'
    with zipfile.ZipFile(os.path.join(root, 'original', 'gif-white', row['sex'], row['zip'])) as outer:
        inner = zipfile.ZipFile(io.BytesIO(outer.read(row['inner'])))
    with tempfile.TemporaryDirectory(dir=os.path.join(root, 'build-appwebp', 'tmp')) as tmp:
        gif = os.path.join(tmp, 's.gif')
        open(gif, 'wb').write(inner.read(src))
        vf = f'scale={PX}:{PX}:force_original_aspect_ratio=decrease:flags=lanczos,pad={PX}:{PX}:(ow-iw)/2:(oh-ih)/2:white'
        subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', gif, '-vf', vf, '-c:v', 'libwebp_anim',
                        '-lossless', '0', '-q:v', str(Q), '-compression_level', '6', '-loop', '0', '-an', out + '.part.webp'], check=True)
        os.replace(out + '.part.webp', out)
    return row['gv'], 'ok'

def main():
    a = sys.argv[1:]
    if not a: sys.exit(__doc__)
    root = os.path.abspath(a[0]); jobs = int(a[a.index('--jobs') + 1]) if '--jobs' in a else 3
    only = set(a[a.index('--only') + 1].split(',')) if '--only' in a else None
    rows = json.load(open(os.path.join(root, 'work', 'index.json')))
    if only: rows = [r for r in rows if r['gv'] in only]
    os.makedirs(os.path.join(root, 'build-appwebp', 'tmp'), exist_ok=True)
    done = failed = 0
    with ProcessPoolExecutor(jobs) as pool:
        for f in as_completed([pool.submit(encode, (root, r)) for r in rows]):
            try: gv, state = f.result()
            except Exception as e: failed += 1; print('FAIL', e, flush=True); continue
            if state == 'no-source': failed += 1; print('NO SOURCE', gv, flush=True)
            done += 1
            if done % 250 == 0: print(f'{done}/{len(rows)}', flush=True)
    print(f'done {done}, failed {failed}', flush=True)

if __name__ == '__main__':
    main()
