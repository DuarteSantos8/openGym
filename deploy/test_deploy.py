"""Run the real Bash transaction with fake Docker/HTTP, never production data.

Linux: python3 deploy/test_deploy.py (requires bash, jq and coreutils).
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

NEW = 'a' * 40
OLD = 'b' * 40

MOCK = r'''
import json, os, sys
from pathlib import Path
root = Path(os.environ['FIXTURE'])
state = json.loads((root / 'docker.json').read_text())
command, *args = sys.argv[1:]
if command == 'curl':
    if '/branches/main' in args[-1]:
        print(json.dumps({'commit': {'sha': 'a' * 40}}))
    elif '/actions/runs?' in args[-1]:
        print(json.dumps({'workflow_runs': [{'path': '.github/workflows/ci.yml',
            'head_sha': 'a' * 40, 'event': 'push', 'status': 'completed',
            'conclusion': state.get('ci', 'success')}]}))
    else:
        print('401')
elif args[0] == 'pull':
    pass
elif args[:2] == ['image', 'inspect']:
    image = args[-1]
    if '.Id' in args[-2]:
        print('new-' + image.split('opengym-')[1].split(':')[0])
    else:
        print('b' * 40 if image.startswith('old-') else state.get('revision', 'a' * 40))
elif args[0] == 'inspect':
    service = args[-1].removeprefix('opengym-').removesuffix('-1')
    image = state['running'].get(service)
    if not image:
        sys.exit(1)
    print(image + (' true' if len(args) > 2 and '.State.Running' in args[-2] else ''))
elif args[0] == 'exec':
    sys.stdin.read()
    if state.get('fail') and state['running'].get('nutrition', '').startswith('new-'):
        sys.exit(1)
elif args[0] == 'rm':
    state['running'].pop('nutrition', None)
elif args[0] == 'compose':
    files = [args[i+1] for i, v in enumerate(args) if v == '-f']
    if files[-1].endswith('images.json'):
        state['running'].update({k: v['image'] for k, v in json.loads(Path(files[-1]).read_text())['services'].items()})
    else:
        state['running'] = {k: 'new-' + k for k in ('api', 'web', 'nutrition')}
    state['updates'] = state.get('updates', 0) + 1
else:
    raise RuntimeError(args)
(root / 'docker.json').write_text(json.dumps(state))
'''

class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'bin').mkdir()
        source = Path(__file__).with_name('opengym-deploy').read_text()
        source = source.replace('/opt/opengym', str(self.root)).replace('/var/lib/opengym-deploy', str(self.root / 'state'))
        source = source.replace('/run/opengym-deploy.lock', str(self.root / 'lock')).replace('READY_TIMEOUT_SECONDS=120', 'READY_TIMEOUT_SECONDS=1')
        (self.root / 'deploy').write_text(source)
        (self.root / '.env').write_text('IMAGE_TAG=sha-' + OLD + '\nKEEP=unchanged\n')
        (self.root / 'compose.prod.yml').write_text('original compose\n')
        (self.root / 'state').mkdir()
        (self.root / 'state/release-compose').write_text('three-service compose\n')
        (self.root / 'mock.py').write_text(MOCK)
        for command in ('docker', 'curl'):
            self.executable(command, f'#!/bin/sh\nexec {sys.executable} {self.root}/mock.py {command} "$@"\n')
        # HTTP/asset checks are mocked; production readiness is checked separately.
        self.executable('python3', '#!/bin/sh\ncat >/dev/null\nexit 0\n')
        self.executable('sleep', '#!/bin/sh\nexit 0\n')
        self.configure()

    def executable(self, name, content):
        file = self.root / 'bin' / name
        file.write_text(content)
        file.chmod(0o755)

    def configure(self, nutrition=False, **options):
        running = {k: 'old-' + k for k in ('api', 'web')}
        if nutrition:
            running['nutrition'] = 'old-nutrition'
        (self.root / 'docker.json').write_text(json.dumps(dict(running=running, **options)))

    def run_deploy(self, *args, success=True):
        result = subprocess.run(['bash', str(self.root / 'deploy'), *args],
            env=dict(os.environ, FIXTURE=str(self.root), PATH=str(self.root / 'bin') + ':' + os.environ['PATH']),
            capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result.stdout

    def state(self):
        return json.loads((self.root / 'docker.json').read_text())

    def test_legacy_upgrade_and_idempotency(self):
        self.run_deploy()
        self.assertEqual(self.state()['running'], {k: 'new-' + k for k in ('api', 'web', 'nutrition')})
        self.run_deploy()
        self.assertEqual(self.state()['updates'], 1)
        self.assertIn('KEEP=unchanged', (self.root / '.env').read_text())

    def test_nutrition_failure_restores_all_three_exact_images(self):
        self.configure(nutrition=True, fail=True)
        self.run_deploy(success=False)
        self.assertEqual(self.state()['running'], {k: 'old-' + k for k in ('api', 'web', 'nutrition')})
        self.assertIn('sha-' + NEW, (self.root / 'state/failed-releases').read_text())
        self.run_deploy()
        self.assertEqual(self.state()['updates'], 2)

    def test_first_upgrade_failure_removes_only_new_nutrition(self):
        self.configure(fail=True)
        self.run_deploy(success=False)
        self.assertEqual(self.state()['running'], {'api': 'old-api', 'web': 'old-web'})
        self.assertIn('sha-' + OLD, (self.root / '.env').read_text())

    def test_manual_rollback_holds_updates_and_resume_keeps_bad_release_blocked(self):
        self.run_deploy()
        self.run_deploy('--rollback')
        self.assertEqual(self.state()['running'], {'api': 'old-api', 'web': 'old-web'})
        self.assertTrue((self.root / 'state/hold').exists())
        self.run_deploy()
        self.run_deploy('--resume')
        self.assertEqual(self.state()['updates'], 2)
        self.assertFalse((self.root / 'state/hold').exists())

    def test_failed_ci_never_pulls_or_changes_release(self):
        self.configure(ci='failure')
        self.run_deploy()
        self.assertNotIn('updates', self.state())
        self.assertEqual(self.state()['running']['api'], 'old-api')

    def test_wrong_image_revision_never_changes_release(self):
        self.configure(revision='c' * 40)
        self.run_deploy(success=False)
        self.assertNotIn('updates', self.state())

    def test_interrupted_deployment_recovers_before_github(self):
        self.run_deploy()
        previous = (self.root / 'state/previous').resolve()
        previous.rename(self.root / 'state/pending')
        self.run_deploy()
        self.assertEqual(self.state()['running'], {'api': 'old-api', 'web': 'old-web'})
        self.assertFalse((self.root / 'state/pending').exists())

if __name__ == '__main__':
    unittest.main(verbosity=2)
