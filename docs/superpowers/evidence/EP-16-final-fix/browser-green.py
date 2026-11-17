from pathlib import Path
import re
exec(Path('docs/superpowers/evidence/EP-05b/browser-helpers.py').read_text())
OUT = Path('docs/superpowers/evidence/EP-16-final-fix')
def remote_rows():
    return json.loads(Path('.mvp-final-runtime/data/state-mvp-final-qa.json').read_text()).get('nutritionEntries', [])
def double_save():
    nodes=cdp('Accessibility.getFullAXTree')['nodes']
    node=next(n['backendDOMNodeId'] for n in nodes if n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value')=='Save')
    cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node); time.sleep(.3)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content']
    h=js('innerHeight')
    if sum(q[1::2])/4>h-110:
        cdp('Input.dispatchMouseEvent',type='mouseWheel',x=sum(q[0::2])/4,y=h/2,deltaX=0,deltaY=250); time.sleep(.3)
        q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content']
    x,y=sum(q[0::2])/4,sum(q[1::2])/4
    click_at_xy(x,y); click_at_xy(x,y)
new_tab('about:blank')
cdp('Network.enable'); cdp('Runtime.enable'); cdp('Log.enable')
cdp('Network.setBlockedURLs',urls=['*exercise-media*','https://*'])
cdp('Network.setCookie',**json.loads(Path('.mvp-final-runtime/cookie.json').read_text()))
cdp('Emulation.setDeviceMetricsOverride',width=390,height=900,deviceScaleFactor=1,mobile=False)
cdp('Page.addScriptToEvaluateOnNewDocument',source="window.__qaErrors=[];addEventListener('error',e=>__qaErrors.push(e.message));addEventListener('unhandledrejection',e=>__qaErrors.push(String(e.reason)));")
goto_url('http://172.17.0.4:5180/#/nutrition'); wait_for_load()
wait("!!document.querySelector('[name=barcode]')",25); time.sleep(2)
cap=js('({origin:location.origin, secure:window.isSecureContext, randomUUID:typeof crypto.randomUUID, getRandomValues:typeof crypto.getRandomValues})')
assert cap=={'origin':'http://172.17.0.4:5180','secure':False,'randomUUID':'undefined','getRandomValues':'function'},cap
record('after_capabilities',cap)
assert len(visible())==0
click_name('Add food'); wait("!!document.querySelector('[name=label]')")
fill('label','HTTP manual food'); fill('proteinG','0.024'); double_save()
wait("!document.querySelector('[name=label]')")
assert len(visible())==1
manual=visible()[0]
assert manual['source']=='manual' and manual['proteinG']==0.024
fill('barcode','012345678905'); click_name('Lookup')
wait("!!document.querySelector('.nutrition-source')")
assert len(visible())==1
fill('lookupAmount','250'); double_save()
wait("document.body.innerText.includes('Food saved')")
assert len(visible())==2
lookup=next(e for e in visible() if e['source']=='open-food-facts')
assert lookup['amountMl']==250 and lookup['energyKcal']==100 and lookup['proteinG']==0
assert 'amountG' not in lookup and 'carbohydrateG' not in lookup
assert lookup['sourceSnapshot']['per100']['basis']=='ml' and lookup['sourceSnapshot']['per100']['energyKcal']==40
assert re.fullmatch(r'sha256:[0-9a-f]{64}',lookup['contentFingerprint'])
assert lookup['externalId']=='012345678905'
click_name('Lookup'); wait("!!document.querySelector('.nutrition-source')")
fill('lookupAmount','250'); double_save()
wait("JSON.parse(localStorage.getItem('gym_state_v1')).nutritionEntries?.length===3")
saved=visible()
assert len({e['id'] for e in saved})==3
assert all(re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',e['id']) for e in saved)
lookups=[e for e in saved if e['source']=='open-food-facts']
assert lookups[0]['sourceSnapshot']==lookups[1]['sourceSnapshot']
assert lookups[0]['contentFingerprint']==lookups[1]['contentFingerprint']
end=time.time()+12
while len(remote_rows())!=3 and time.time()<end: time.sleep(.1)
assert len(remote_rows())==3
assert {e['id'] for e in remote_rows()}=={e['id'] for e in saved}
before_errors=js('window.__qaErrors')
cdp('Page.reload',ignoreCache=True); wait_for_load()
wait("!!document.querySelector('[name=barcode]')",25); time.sleep(1)
assert len(visible())==3
assert {e['id'] for e in visible()}=={e['id'] for e in saved}
assert next(e for e in visible() if e['id']==lookup['id'])['sourceSnapshot']==lookup['sourceSnapshot']
assert next(e for e in visible() if e['id']==lookup['id'])['contentFingerprint']==lookup['contentFingerprint']
shot('after-manual-and-lookup-saved-390.png')
errors=before_errors+js('window.__qaErrors')
assert errors==[],errors
record('after_save_results',{'manualSaved':True,'lookupSaved':True,'repeatedMealDistinct':True,'doubleSubmitRows':3,'expectedRows':3,'allIdsV4':True,'serverRows':3,'reloadRetainedIdsAndProvenance':True,'volumeMl':250,'energyKcal':100,'sourceEnergyPer100Ml':40,'unknownCarbohydrateOmitted':True,'runtimeErrors':errors,'session':'synthetically seeded; enrollment not tested'})
print('GREEN: natural insecure HTTP manual/lookup Save, repeated distinct events, duplicate-click protection, server sync and reload/provenance all passed.',cap)
close_tab()
