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

def gif_delays(b):
    # every Graphic Control Extension carries a frame's delay in 1/100 s
    out, i = [], 0
    while (i := b.find(b'\x21\xf9\x04', i)) >= 0:
        out.append(int.from_bytes(b[i + 4:i + 6], 'little') * 10); i += 3
    return out

def fix_timing(path, delays):
    """ffmpeg gives an animation's last frame a made-up duration (263 ms where the GIF says 100),
    an extra stop at every loop. Writes the GIF's own delays into the WebP's ANMF frames."""
    b = bytearray(open(path, 'rb').read())
    spots, i = [], 0
    while (i := b.find(b'ANMF', i)) >= 0:
        spots.append(i + 8 + 12); i += 4   # chunk header, then x, y, w-1, h-1 (3 bytes each)
    if not spots or not delays: return False
    want = delays if len(delays) == len(spots) else [int.from_bytes(b[o:o + 3], 'little') for o in spots[:-1]] + [delays[-1]]
    changed = False
    for o, d in zip(spots, want):
        d = d or 100
        if int.from_bytes(b[o:o + 3], 'little') != d:
            b[o:o + 3] = d.to_bytes(3, 'little'); changed = True
    if changed:
        open(path + '.part', 'wb').write(b); os.replace(path + '.part', path)
    return changed

def encode(job):
    root, row = job
    out = os.path.join(root, 'build-appwebp', row['gv'] + '.webp')
    files = row['files']
    src = files.get('360') or files.get('720') or files.get('1080')
    if not src:
        return row['gv'], 'no-source'
    with zipfile.ZipFile(os.path.join(root, 'original', 'gif-white', row['sex'], row['zip'])) as outer:
        inner = zipfile.ZipFile(io.BytesIO(outer.read(row['inner'])))
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return row['gv'], 'retimed' if fix_timing(out, gif_delays(inner.read(src))) else 'skip'
    with tempfile.TemporaryDirectory(dir=os.path.join(root, 'build-appwebp', 'tmp')) as tmp:
        gif = os.path.join(tmp, 's.gif')
        open(gif, 'wb').write(inner.read(src))
        vf = f'scale={PX}:{PX}:force_original_aspect_ratio=decrease:flags=lanczos,pad={PX}:{PX}:(ow-iw)/2:(oh-ih)/2:white'
        subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', gif, '-vf', vf, '-c:v', 'libwebp_anim',
                        '-lossless', '0', '-q:v', str(Q), '-compression_level', '6', '-loop', '0', '-an', out + '.part.webp'], check=True)
        fix_timing(out + '.part.webp', gif_delays(inner.read(src)))
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
    done = failed = retimed = 0
    with ProcessPoolExecutor(jobs) as pool:
        for f in as_completed([pool.submit(encode, (root, r)) for r in rows]):
            try: gv, state = f.result()
            except Exception as e: failed += 1; print('FAIL', e, flush=True); continue
            if state == 'no-source': failed += 1; print('NO SOURCE', gv, flush=True)
            if state == 'retimed': retimed += 1
            done += 1
            if done % 250 == 0: print(f'{done}/{len(rows)}', flush=True)
    print(f'done {done}, retimed {retimed}, failed {failed}', flush=True)

if __name__ == '__main__':
    main()
