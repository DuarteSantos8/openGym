from pathlib import Path
exec(Path('docs/superpowers/evidence/EP-05b/browser-helpers.py').read_text())
OUT = Path('docs/superpowers/evidence/EP-16-final-fix')
new_tab('about:blank')
cdp('Network.enable'); cdp('Runtime.enable'); cdp('Log.enable')
cdp('Network.setBlockedURLs', urls=['*exercise-media*', 'https://*'])
cdp('Network.setCookie', **json.loads(Path('.mvp-final-runtime/cookie.json').read_text()))
cdp('Emulation.setDeviceMetricsOverride', width=390, height=900, deviceScaleFactor=1, mobile=False)
sid=cdp('Page.addScriptToEvaluateOnNewDocument', source=Path('.mvp-final-runtime/seed.js').read_text())['identifier']
goto_url('http://172.17.0.4:5180/#/nutrition'); wait_for_load()
wait("!!document.querySelector('[name=barcode]')",25)
time.sleep(2) # Let initial boot/layout settle before coordinate input.
cdp('Page.removeScriptToEvaluateOnNewDocument', identifier=sid)
cap = js('({origin:location.origin, secure:window.isSecureContext, randomUUID:typeof crypto.randomUUID, getRandomValues:typeof crypto.getRandomValues})')
assert cap == {'origin':'http://172.17.0.4:5180','secure':False,'randomUUID':'undefined','getRandomValues':'function'},cap
record('before_capabilities',cap)
assert len(visible())==0
click_name('Add food'); wait("!!document.querySelector('[name=label]')")
fill('label','HTTP manual food'); fill('proteinG','0.024'); click_name('Save')
assert len(visible())==0
assert 'Could not save food' in js('document.body.innerText')
shot('before-manual-save-error-390.png')
click_name('Cancel')
fill('barcode','012345678905'); click_name('Lookup')
wait("!!document.querySelector('.nutrition-source')")
fill('lookupAmount','250'); click_name('Save')
assert len(visible())==0
assert 'Could not save food' in js("document.querySelector('.nutrition-lookup').textContent")
shot('before-lookup-save-error-390.png')
record('before_save_failures',{'manual':'Could not save food','lookup':'Could not save food','persistedRows':0,'provider':'committed synthetic HTTPS preload'})
print('RED reproduced naturally insecure HTTP: manual and confirmed lookup Save both fail; zero persisted rows.',cap)
close_tab()
