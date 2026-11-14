# Run through browser-harness on the isolated combined-candidate services.
from pathlib import Path
exec(Path('/code/openGym-fork/docs/superpowers/evidence/EP-05b/browser-helpers.py').read_text())
OUT = Path('/code/openGym-fork/docs/superpowers/evidence/EP-16')
def outbound():
    p = Path('/tmp/opengym-combined-qa/outbound-test.jsonl')
    return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []
def remote_rows():
    return json.loads(Path('/tmp/opengym-combined-qa/state-combined-qa.json').read_text()).get('nutritionEntries', [])
new_tab('about:blank')
cdp('Network.enable')
cdp('Runtime.enable')
cdp('Log.enable')
cdp('Network.setBlockedURLs', urls=['*exercise-media*'])
cdp('Network.setCookie', **json.loads(Path('/tmp/opengym-combined-qa/cookie.json').read_text()))
cdp('Emulation.setDeviceMetricsOverride', width=390, height=900, deviceScaleFactor=1, mobile=False)
cdp('Emulation.setEmulatedMedia', features=[{'name':'prefers-reduced-motion','value':'reduce'}])
sid = cdp('Page.addScriptToEvaluateOnNewDocument', source=Path('/tmp/opengym-combined-qa/seed.js').read_text())['identifier']
goto_url('http://localhost:5179/#/nutrition')
wait_for_load()
wait("!!document.querySelector('[name=barcode]')", 25)
cdp('Page.removeScriptToEvaluateOnNewDocument', identifier=sid)
assert len(outbound()) == 0
assert len(visible()) == 0
fill('barcode', '3017620422003')
assert len(outbound()) == 0
click_name('Lookup')
wait("!!document.querySelector('.nutrition-source')")
fill('lookupAmount', '25')
assert len(visible()) == 0
shot('combined-preview-390.png')
click_name('Save')
wait("JSON.parse(localStorage.getItem('gym_state_v1')).nutritionEntries?.length===1")
saved = visible()[0]
assert saved['energyKcal'] == 50 and saved['amountG'] == 25
assert saved['fatG'] == 0 and 'carbohydrateG' not in saved
assert len(outbound()) == 1
for _ in range(100):
    if len(remote_rows()) == 1: break
    time.sleep(.1)
assert remote_rows()[0]['sourceSnapshot'] == saved['sourceSnapshot']
record('explicit_save_and_server_sync', {'provider_calls_before_lookup':0,'synthetic_provider_calls':1,'amountG':25,'energyKcal':50,'known_zero':True,'unknown_omitted':True,'server_snapshot_matches':True})
cdp('Network.emulateNetworkConditions', offline=True, latency=0, downloadThroughput=-1, uploadThroughput=-1)
click_name('Edit')
wait("!!document.querySelector('.sheet [name=energyKcal]')")
assert js("document.querySelector('.sheet').textContent.includes('Open Food Facts')")
fill('energyKcal','123')
click_name('Save')
wait("!document.querySelector('.sheet [name=energyKcal]')")
edited = visible()[0]
assert edited['energyKcal'] == 123
assert edited['sourceSnapshot'] == saved['sourceSnapshot'] and edited['contentFingerprint'] == saved['contentFingerprint']
assert len(outbound()) == 1
record('offline_edit', {'entry_energyKcal':123,'original_source_energyKcal':200,'snapshot_and_hash_retained':True,'extra_provider_calls':0})
cdp('Network.emulateNetworkConditions', offline=False, latency=0, downloadThroughput=-1, uploadThroughput=-1)
fill('barcode','96385074')
click_name('Lookup')
wait("!!document.querySelector('[role=alert]')")
assert len(visible()) == 1
click_name('Add food')
fill('label','Combined manual fallback')
fill('proteinG','0.024')
click_name('Save')
wait("JSON.parse(localStorage.getItem('gym_state_v1')).nutritionEntries?.length===2")
assert visible()[1]['proteinG'] == .024
assert len(outbound()) == 2
record('unknown_product_manual_fallback', {'manual_proteinG':.024,'rows':2,'synthetic_provider_calls':2})
print('Combined explicit lookup/save/server sync, offline edit and manual fallback passed.')
