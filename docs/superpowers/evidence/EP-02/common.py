# Shared preamble, inlined by run.sh into capture.py and probe.py (browser-harness reads one script from stdin).
import json, os, sys, time
BASE = os.environ.get('BASE', 'http://127.0.0.1:5199')
assert BASE.split('//')[1].split(':')[0] in ('127.0.0.1', 'localhost'), 'throwaway local dev origin only'
HERE = os.environ.get('EVID', os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else '.')
S = open(os.environ.get('STATE', HERE + '/state.json')).read()
RM = os.environ.get('RM', 'no-preference')
def wait_for(expr, secs=6):
    t = time.time()
    while time.time() - t < secs:
        if js(expr): return True
        time.sleep(.2)
    return False
def open_blocked():
    # about:blank first, block licensed media, only then load the app
    new_tab("about:blank")
    me = current_tab()
    cdp("Network.enable"); cdp("Log.enable"); cdp("Runtime.enable")
    cdp("Network.setBlockedURLs", urls=["*exercise-media*", "*.gif", "*.webp", "*.mp4"])
    cdp("Emulation.setFocusEmulationEnabled", enabled=True)
    cdp("Emulation.setEmulatedMedia", features=[{"name": "prefers-reduced-motion", "value": RM}])
    cdp("Page.navigate", url=BASE + "/#/home"); wait_for_load(); time.sleep(1)
    # Refuse BEFORE touching any tab or storage: a profile that is not this fixture (a real or signed-in one) is never closed over or cleared.
    cur = js("localStorage.getItem('gym_state_v1')")
    if cur and 'ep02-w' not in cur and os.environ.get('ALLOW_OVERWRITE') != '1':
        raise SystemExit("refusing to touch a non-fixture profile on " + BASE)
    # Only now: tabs left by an earlier run on this exact origin share its storage and would sync old state into the new one. Other origins are never touched.
    origin = BASE.rstrip('/')
    for t in list_tabs():
        tid = t.get('targetId') or t.get('id')
        if tid != (me.get('targetId') if isinstance(me, dict) else me) and t.get('url', '').startswith(origin):
            try: close_tab(tid)
            except Exception: pass
    # Clear this one origin only (its storage and cookies), never the browser's other cookies.
    cdp("Storage.clearDataForOrigin", origin=origin, storageTypes="all")
_seed_id = [None]; _seed_n = [0]
def seed(theme=None, lang='en'):
    """Seed through a script that runs before the app on the next load (the app writes its in-memory state back on unload, so
    writing localStorage and reloading would be overwritten). The sessionStorage flag stops later reloads from re-seeding."""
    s = json.loads(S); s['theme'] = theme or s['theme']; s['lang'] = lang
    _seed_n[0] += 1
    if _seed_id[0]: cdp("Page.removeScriptToEvaluateOnNewDocument", identifier=_seed_id[0])
    src = "if(!sessionStorage.getItem('ep02seed%d')){localStorage.setItem('gym_state_v1',%s);sessionStorage.setItem('ep02seed%d','1')}" % (_seed_n[0], json.dumps(json.dumps(s)), _seed_n[0])
    _seed_id[0] = cdp("Page.addScriptToEvaluateOnNewDocument", source=src)["identifier"]
    cdp("Page.reload"); wait_for_load(); time.sleep(1.2)
    for _ in range(4):
        js("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Continue without account'));b&&b.click()})()"); time.sleep(.8)
        if js("!!document.querySelector('#tabbar')"): break
def goto(h):
    js("location.hash=%s" % json.dumps(h)); time.sleep(.9)
    if js("location.hash") != h: raise SystemExit("route did not apply: %s got %s" % (h, js("location.hash")))
def viewport(w, h):
    cdp("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=1, mobile=(w < 500)); time.sleep(.5)
def observed():
    return json.loads(js("""JSON.stringify({hash:location.hash,theme:document.documentElement.dataset.theme,dir:document.documentElement.dir,
fontSize:getComputedStyle(document.documentElement).fontSize,bg:getComputedStyle(document.body).backgroundColor,
h1:(document.querySelector('h1')||{}).textContent||'',text:document.body.innerText.slice(0,4000),
overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth,title:document.title})"""))
def lum(rgb):
    v = [int(x) for x in rgb[rgb.index('(')+1:rgb.index(')')].split(',')[:3]]
    return (0.2126*v[0] + 0.7152*v[1] + 0.0722*v[2]) / 255
def real_click(sel, label=None):
    """Scroll into view, resolve the centre from DOM geometry, require elementFromPoint to reach the target, then a CDP mouse press+release."""
    js("(()=>{const e=%s;e&&e.scrollIntoView({block:'center',behavior:'instant'})})()" % sel); time.sleep(.5)
    r = json.loads(js("""(()=>{const e=%s;if(!e)return JSON.stringify({err:'missing'});
const b=e.getBoundingClientRect();const x=b.x+b.width/2,y=b.y+b.height/2;const top=document.elementFromPoint(x,y);
return JSON.stringify({x,y,w:b.width,h:b.height,hit:!!top&&(e===top||e.contains(top))})})()""" % sel))
    if r.get('err') or not r['hit']: raise SystemExit("real click target unreachable: %s %s at %s: %s" % (sel, r, js("location.hash"), js("document.body.innerText.slice(0,120)") + " sheets=" + str(js("document.querySelectorAll('.sheet').length")) + " sheetText=" + str(js("[...document.querySelectorAll('.sheet')].map(e=>e.innerText.slice(0,80)).join('~')"))))
    for ty in ("mousePressed", "mouseReleased"):
        cdp("Input.dispatchMouseEvent", type=ty, x=r['x'], y=r['y'], button="left", buttons=1 if ty == "mousePressed" else 0, clickCount=1)
    return r
def key(k, code, vk, text=None):
    cdp("Input.dispatchKeyEvent", type="rawKeyDown" if not text else "keyDown", key=k, code=code, windowsVirtualKeyCode=vk, **({"text": text} if text else {}))
    cdp("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk)
def errors_from(ev):
    out = []
    for e in ev:
        m = e.get('method'); p = e.get('params', {})
        if m == 'Runtime.exceptionThrown': out.append(('exception', json.dumps(p)[:200]))
        elif m == 'Log.entryAdded' and p['entry']['level'] == 'error': out.append(('log', (p['entry'].get('text', '') + ' ' + p['entry'].get('url', ''))[:200]))
        elif m == 'Network.loadingFailed' and not p.get('canceled') and p.get('blockedReason') is None: out.append(('failed', json.dumps(p)[:200]))
    return out
def is_expected(e):
    # guest /api/me 401 (signed-out probe) and Chrome's navigator.vibrate intervention (headless, no user activation); both disclosed in README
    return e[0] == 'log' and (('/api/me' in e[1] and '401' in e[1]) or 'Blocked call to navigator.vibrate' in e[1])
