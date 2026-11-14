import datetime
import json
import os
import pathlib
import subprocess
import sys

root = pathlib.Path('/code/openGym-fork')
out = root / 'docs/superpowers/evidence/EP-16'
env = dict(os.environ)
env['PATH'] = '/home/cloudroom-agent/tools/node-v22.23.5-linux-x64/bin:' + env['PATH']
env['NO_COLOR'] = '1'
env['RAYON_NUM_THREADS'] = '2'
env.pop('FORCE_COLOR', None)
prefix = os.environ.get('VERIFY_PREFIX', '')
if prefix and (not prefix.replace('-', '').isalnum() or len(prefix) > 40):
    raise SystemExit('Invalid evidence prefix')
stages = [
    ('frontend-full', 'frontend', ['npm', 'test', '--', '--maxWorkers=1']),
    ('api-full', 'api', ['node', '--test', '--test-concurrency=2', *sorted(str(p.relative_to(root / 'api')) for p in (root / 'api/test').glob('*.test.js'))]),
    ('mcp-full', 'mcp', ['npm', 'test', '--', '--maxWorkers=2']),
    ('build', 'frontend', ['npm', 'run', 'build']),
    ('locales', 'frontend', ['node', 'scripts/check-locales.mjs']),
    ('source-strings', 'frontend', ['node', 'scripts/check-source-strings.mjs', '--strict']),
    ('catalogue', '.', ['node', 'scripts/catalogue/build.mjs', '--check']),
    ('coach-assets', '.', ['node', 'scripts/build-coach-assets.mjs', '--check']),
    ('api-docs', '.', ['node', 'scripts/build-api-docs.mjs', '--check']),
]
chosen = set(sys.argv[1:])
sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
node = subprocess.check_output(['node', '-v'], env=env, text=True).strip()
def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

for name, subdir, command in stages:
    if chosen and name not in chosen:
        continue
    manifest = out / (prefix + name + '.json')
    logfile = out / (prefix + name + '.log')
    if manifest.exists() or logfile.exists():
        raise SystemExit('Refusing to overwrite existing evidence: ' + name)
    dirty = subprocess.check_output(['git', 'diff', '--name-only', 'HEAD', '--', 'frontend', 'api', 'mcp', 'scripts', '*lock*'], cwd=root, text=True).strip()
    if dirty:
        raise SystemExit('Uncommitted runtime changes: ' + dirty)
    record = dict(name=name, sha=sha, node=node, cwd=str(root / subdir), command=command, started=now(), status='running')
    manifest.write_text(json.dumps(record, indent=2) + '\n')
    print(name + ' started ' + record['started'] + ' at ' + sha, flush=True)
    with logfile.open('w') as stream:
        stream.write(json.dumps(record) + '\n')
        stream.flush()
        proc = subprocess.run(command, cwd=root / subdir, env=env, stdout=stream, stderr=subprocess.STDOUT)
    record.update(ended=now(), exit=proc.returncode, status='passed' if proc.returncode == 0 else 'failed')
    manifest.write_text(json.dumps(record, indent=2) + '\n')
    print(name + ' exit=' + str(proc.returncode) + ' ended ' + record['ended'], flush=True)
    print('\n'.join(logfile.read_text(errors='replace').splitlines()[-12:]), flush=True)
    if proc.returncode:
        raise SystemExit(proc.returncode if proc.returncode > 0 else 128 - proc.returncode)
