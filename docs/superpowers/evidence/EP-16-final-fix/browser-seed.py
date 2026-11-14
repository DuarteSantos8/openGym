# Synthetic session/data only. No password/passkey enrollment; never commit generated runtime files.
from pathlib import Path
import base64, hashlib, hmac, json, secrets, time
runtime = Path('.mvp-final-runtime'); data = runtime / 'data'
data.mkdir(parents=True, exist_ok=True)
now = int(time.time()*1000)
user = {'id': 'mvp-final-qa', 'name': 'Final fix QA', 'sv': 0}
state = {'unit': 'kg', 'lang': 'en', 'theme': 'dark', 'modules': {'nutrition': True}, 'workouts': [], 'routines': [], 'bodyweight': [], 'customEx': [], '_ts': now, '_rev': 1}
secret = secrets.token_hex(32)
(data/'secret').write_text(secret); (data/'secret').chmod(0o600)
(data/'db.json').write_text(json.dumps({'users': [user], 'creds': [], 'subs': [], 'invites': []}))
(data/'state-mvp-final-qa.json').write_text(json.dumps(state))
payload = f'{user["id"]}:{now+3600000}:0:c'
mac = base64.urlsafe_b64encode(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip('=')
(runtime/'cookie.json').write_text(json.dumps({'name': 'gymsid', 'value': payload+'.'+mac, 'url': 'http://172.17.0.4:5180/', 'httpOnly': True, 'sameSite': 'Lax'}))
(runtime/'cookie.json').chmod(0o600)
items = {'gym_state_v1':json.dumps(state), 'gym_user':json.dumps(user), 'gym_owner':user['id'], 'gym_state_owner':user['id'], 'gym_sync':json.dumps({'rev':1,'ts':now}), 'gym_tour_v1':json.dumps({'offered':now})}
(runtime/'seed.js').write_text('for(const [k,v] of Object.entries('+json.dumps(items)+'))localStorage.setItem(k,v);')
print('Synthetic session/state seeded; credentials retained only in throwaway runtime directory.')
