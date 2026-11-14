# EP-02 real-browser assertions. Run:  BASE=http://127.0.0.1:5199 RM=no-preference|reduce browser-harness < probe.py
# Needs the Vite dev server (for the MetricCard keyboard step, which imports the module from /src) and
# a synthetic profile (state.json is built by the capture seed: 1 routine, 4 workouts, 3 weigh-ins, restSec 90).
# Every step asserts; any failure exits non-zero and the output says which.
import json, os, sys, time
BASE=os.environ.get('BASE','http://127.0.0.1:5199'); RM=os.environ.get('RM','no-preference')
S=open(os.environ.get('STATE','/tmp/cap/state.json')).read()
res={}; fails=[]
def check(name, cond, detail=None):
    res[name]=detail if detail is not None else bool(cond)
    if not cond: fails.append(name)
new_tab(BASE+"/"); wait_for_load()
cdp("Network.enable"); cdp("Network.setBlockedURLs", urls=["*exercise-media*","*.gif","*.webp","*.mp4"])
cdp("Emulation.setFocusEmulationEnabled", enabled=True)  # key events reach the page even when the tab is in the background
cdp("Emulation.setEmulatedMedia", features=[{"name":"prefers-reduced-motion","value":RM}])
cdp("Emulation.setDeviceMetricsOverride", width=390, height=844, deviceScaleFactor=1, mobile=True)
js("localStorage.clear(); localStorage.setItem('gym_state_v1', %s)" % json.dumps(S))
cdp("Page.reload"); wait_for_load(); time.sleep(1.5)
js("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Continue without account'));b&&b.click()})()"); time.sleep(1.5)
js("location.hash='#/home'"); time.sleep(1)
def wait_for(expr, secs=6):
    t=time.time()
    while time.time()-t<secs:
        if js(expr): return True
        time.sleep(.2)
    return False
for _ in range(4):
    if wait_for("!!document.querySelector('.tag.acc')", 3): break
    js("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Continue without account'));b&&b.click()})()"); time.sleep(1); js("location.hash='#/home'")
state=lambda: json.loads(js("localStorage.getItem('gym_state_v1')"))
n0=len(state()['workouts'])
check("metric_anim_matches_motion_setting", js("getComputedStyle(document.querySelector('.metric')).animationName")==('none' if RM=='reduce' else 'viewfade'))
# TAP 1: Start (the row's Start tag)
check("start_row_present", wait_for("!!document.querySelector('.tag.acc')"))
js("document.querySelector('.tag.acc').click()"); wait_for("location.hash=='#/workout'"); time.sleep(.8)
check("workout_open", js("location.hash")=="#/workout")
# TAP 2: Set 1 done (weight and reps prefilled). Measure click to stored state.
ms=js("""new Promise(res=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Set 1 done');
const t0=performance.now();b.click();const chk=()=>{const a=JSON.parse(localStorage.getItem('gym_state_v1')).active;
if((a&&a.entries[0].sets[0].done)||performance.now()-t0>1500)res(performance.now()-t0);else requestAnimationFrame(chk)};chk()})""")
check("set_done_persisted", state()['active']['entries'][0]['sets'][0]['done'] is True, {"ms":round(ms,1)})
check("set_done_under_100ms", ms<100, round(ms,1))
time.sleep(.5)
t1=js("document.querySelector('#timer.rest')&&document.querySelector('#timer.rest').innerText")
check("rest_timer_visible", t1 and ':' in t1, t1)
time.sleep(1.3)
t2=js("document.querySelector('#timer.rest')&&document.querySelector('#timer.rest').innerText")
check("rest_timer_counts_down", t1!=t2, [t1,t2])
# Finish then save
js("document.querySelector('.whdr-finish').click()"); wait_for("[...document.querySelectorAll('button')].some(b=>/Finish workout early/.test(b.textContent))")
res["finish_buttons"]=json.loads(js("JSON.stringify([...document.querySelectorAll('button')].map(b=>b.className.slice(0,30)+'|'+b.textContent.trim().slice(0,40)).filter(x=>/inish|ave/.test(x)))"))
js("[...document.querySelectorAll('button')].find(b=>/Finish workout early/.test(b.textContent)).click()"); wait_for("[...document.querySelectorAll('button.primary')].some(b=>b.textContent.trim()==='Finish workout')")
js("(()=>{const b=[...document.querySelectorAll('button.primary')].find(b=>b.textContent.trim()==='Finish workout');window.__fin=b&&b.textContent.trim();b&&b.click()})()"); wait_for("JSON.parse(localStorage.getItem('gym_state_v1')).workouts.length==%d"%(n0+1)); time.sleep(.5)
st=state()
check("saved_workout_added", len(st['workouts'])==n0+1 and st.get('active') in (None,False), {"before":n0,"after":len(st['workouts']),"button":js("window.__fin")})
cdp("Page.reload"); wait_for_load(); time.sleep(1.5)
st=state()
check("persists_after_reload", len(st['workouts'])==n0+1 and not st.get('active'))
# Keyboard: real key events on a clickable MetricCard
cdp("Page.navigate", url=BASE+"/#/home"); time.sleep(1)
js("""(async()=>{const React=(await import('/node_modules/.vite/deps/react.js')).default;const RD=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const M=(await import('/src/components/MetricCard.jsx')).default;window.__n=0;const h=document.createElement('div');h.id='kbhost';h.style.cssText='position:fixed;top:0;left:0;z-index:9999;background:#fff;color:#000;width:300px';document.body.appendChild(h);
RD.createRoot(h).render(React.createElement(M,{label:'Body weight',value:'82.4',unit:'kg',delta:-0.6,deltaText:'\\u22120.6',onClick:()=>{window.__n++}}))})()"""); time.sleep(1)
check("kb_host_mounted", wait_for("!!document.querySelector('#kbhost button')", 10))
js("document.querySelector('#kbhost button').focus()")
check("metric_focus_and_name", js("document.activeElement.getAttribute('aria-label')")=="Body weight: 82.4 kg −0.6", js("document.activeElement.getAttribute('aria-label')"))
cdp("Input.dispatchKeyEvent",type="rawKeyDown",key="Shift",code="ShiftLeft",windowsVirtualKeyCode=16); cdp("Input.dispatchKeyEvent",type="keyUp",key="Shift",code="ShiftLeft",windowsVirtualKeyCode=16)  # first synthetic key after focus is otherwise dropped
cdp("Input.dispatchKeyEvent",type="rawKeyDown",key="Enter",code="Enter",windowsVirtualKeyCode=13)
cdp("Input.dispatchKeyEvent",type="char",key="Enter",code="Enter",windowsVirtualKeyCode=13,text="\r")
cdp("Input.dispatchKeyEvent",type="keyUp",key="Enter",code="Enter",windowsVirtualKeyCode=13)
check("enter_activates_once", js("window.__n")==1, js("window.__n"))
cdp("Input.dispatchKeyEvent",type="keyDown",key=" ",code="Space",windowsVirtualKeyCode=32,text=" ")
cdp("Input.dispatchKeyEvent",type="keyUp",key=" ",code="Space",windowsVirtualKeyCode=32)
check("space_activates_once", js("window.__n")==2, js("window.__n"))
check("focus_ring_visible", js("getComputedStyle(document.activeElement).outlineStyle")=="solid")
r=js("(()=>{const r=document.querySelector('#kbhost button').getBoundingClientRect();return [r.width,r.height]})()")
check("touch_target_44", r[0]>=44 and r[1]>=44, r)
try: close_tab()
except Exception: pass
print(json.dumps({"motion":RM,"taps_to_log_one_set":2,"results":res,"failed":fails},indent=1))
if fails: sys.exit(1)
