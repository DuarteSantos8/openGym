#!/usr/bin/env python3
"""Turns the licensed Gym visual pack into the media files openGym ships.

Run by the maintainer only, against the private archive (never committed, never published):

    python3 -I scripts/media/build-media.py /path/to/opengym-media [--jobs 6] [--only 0001,0002]

Reads <archive>/work/index.json (built from the pack's file names) and the white-background GIF
ZIPs under <archive>/original/gif-white/, and writes to <archive>/build/:

    web/<id>.mp4     180 px loop  -> the Docker image (licence Part A: 180x180 max outside apps)
    still/<id>.webp  180 px still -> the Docker image and catalogue/media/ in the repository
    app/<id>.mp4     360 px loop  -> the Android package only (licence Part B)

Quality: the 180 px loop is near-lossless (x264 crf 14, PSNR ~53 dB against the source GIF), the
still is lossless WebP, the 360 px loop crf 22 (~47 dB). 4:2:0 on purpose: phones and Safari do
not decode H.264 4:4:4. Line drawings on white compress well, so this costs ~23 KB a loop.

Media are only decoded and re-encoded by ffmpeg here. Nothing is ever looked at, described or
handed to any AI system (Gym visual T&C 6.2), and nothing is fetched from gymvisual.com.
Files that already exist are skipped, so an interrupted run picks up where it stopped.
"""
import io, json, os, subprocess, sys, tempfile, zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed

WEB_PX, APP_PX = 180, 360


def ffmpeg(args):
    subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', *args], check=True)


def encode(job):
    root, row = job
    gv, out = row['gv'], os.path.join(root, os.environ.get('MEDIA_BUILD', 'build'))
    targets = {
        'web': os.path.join(out, 'web', gv + '.mp4'),
        'still': os.path.join(out, 'still', gv + '.webp'),
        'app': os.path.join(out, 'app', gv + '.mp4'),
    }
    if all(os.path.exists(p) for p in targets.values()):
        return gv, 'skip'
    files = row['files']
    small = files.get(str(WEB_PX))
    big = files.get(str(APP_PX)) or files.get('720') or files.get('1080')
    if not small or not big:
        return gv, 'no-source'
    with zipfile.ZipFile(os.path.join(root, 'original', 'gif-white', row['sex'], row['zip'])) as outer:
        inner = zipfile.ZipFile(io.BytesIO(outer.read(row['inner'])))
    with tempfile.TemporaryDirectory(dir=os.path.join(root, os.environ.get('MEDIA_BUILD', 'build'), 'tmp')) as tmp:
        src_small = os.path.join(tmp, 's.gif')
        src_big = os.path.join(tmp, 'b.gif')
        open(src_small, 'wb').write(inner.read(small))
        open(src_big, 'wb').write(inner.read(big))
        mp4 = ['-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an']
        if not os.path.exists(targets['web']):
            # scale+pad keeps the result inside 180x180 even for an odd-sized source frame
            vf = f'scale={WEB_PX}:{WEB_PX}:force_original_aspect_ratio=decrease,pad={WEB_PX}:{WEB_PX}:(ow-iw)/2:(oh-ih)/2:white'
            ffmpeg(['-i', src_small, '-vf', vf, *mp4, '-crf', '14', targets['web'] + '.part.mp4'])
            os.replace(targets['web'] + '.part.mp4', targets['web'])
        if not os.path.exists(targets['still']):
            vf = f'scale={WEB_PX}:{WEB_PX}:force_original_aspect_ratio=decrease'
            ffmpeg(['-i', src_small, '-vf', vf, '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', targets['still'] + '.part.webp'])
            os.replace(targets['still'] + '.part.webp', targets['still'])
        if not os.path.exists(targets['app']):
            vf = f'scale={APP_PX}:{APP_PX}:force_original_aspect_ratio=decrease,pad={APP_PX}:{APP_PX}:(ow-iw)/2:(oh-ih)/2:white'
            ffmpeg(['-i', src_big, '-vf', vf, *mp4, '-crf', '22', targets['app'] + '.part.mp4'])
            os.replace(targets['app'] + '.part.mp4', targets['app'])
    return gv, 'ok'


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    root = os.path.abspath(args[0])
    jobs = int(args[args.index('--jobs') + 1]) if '--jobs' in args else 4
    only = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
    rows = json.load(open(os.path.join(root, 'work', 'index.json')))
    if only:
        rows = [r for r in rows if r['gv'] in only]
    for d in ('web', 'still', 'app', 'tmp'):
        os.makedirs(os.path.join(root, os.environ.get('MEDIA_BUILD', 'build'), d), exist_ok=True)
    done = failed = 0
    with ProcessPoolExecutor(jobs) as pool:
        futures = [pool.submit(encode, (root, r)) for r in rows]
        for f in as_completed(futures):
            try:
                gv, state = f.result()
            except Exception as e:  # keep going; the run is resumable
                failed += 1
                print('FAIL', e, flush=True)
                continue
            if state == 'no-source':
                failed += 1
                print('NO SOURCE', gv, flush=True)
            done += 1
            if done % 200 == 0:
                print(f'{done}/{len(rows)}', flush=True)
    print(f'done {done}, failed {failed}', flush=True)


if __name__ == '__main__':
    main()
