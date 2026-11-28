# Real-pointer, real-key browser assertions. Env: BASE, RM, OUT_JSON. Counts taps and Tab stops; every user action is a CDP mouse or key event.
res = {}; fails = []
def check(name, cond, detail=None):
    res[name] = detail if detail is not None else bool(cond)
    if not cond: fails.append(name)
open_blocked(); seed("dark"); viewport(390, 844); goto("#/home")
wait_for("!!document.querySelector('.tag.acc')")
n0 = len(json.loads(js("localStorage.getItem('gym_state_v1')"))['workouts'])
has_metric = js("!!document.querySelector('.metric')")
res["metricPresent"] = has_metric
if has_metric: check("metric_anim_matches_motion_setting", js("getComputedStyle(document.querySelector('.metric')).animationName") == ('none' if RM == 'reduce' else 'viewfade'))
taps = 0
real_click("document.querySelector('.tag.acc')"); taps += 1      # TAP 1: Start
check("workout_open", wait_for("location.hash=='#/workout'"))
wait_for("!!document.querySelector('button[aria-label=\"Set 1 done\"]')")
# focus stops: from the initial focus (document body, nothing focused) press Tab until Set 1 done is focused
js("document.activeElement&&document.activeElement.blur()")
stops = 0
for _ in range(60):
    key("Tab", "Tab", 9); stops += 1
    if js("document.activeElement&&document.activeElement.getAttribute('aria-label')") == 'Set 1 done': break
check("tab_reaches_set_done", js("document.activeElement.getAttribute('aria-label')") == 'Set 1 done', {"tabStopsFromInitialFocus": stops})
js("document.activeElement.blur(); window.scrollTo(0,0)")
# TAP 2: real pointer on Set 1 done. Two timings from the native pointerdown event (page clock, rAF-polled, so the resolution is one frame):
#   visible = the checkbox reads aria-checked=true; stored = gym_state_v1 in localStorage holds the set as done (the store writes it on every change).
# The 800 ms native-file save and the 1500 ms server sync are not waited on.
js("""window.__t0=null;window.__v=null;window.__s=null;document.addEventListener('pointerdown',()=>{window.__t0=performance.now()},{capture:true,once:true});
const chk=()=>{if(window.__t0!==null){const n=performance.now();
 if(window.__v===null&&document.querySelector('button[aria-label="Set 1 done"]').getAttribute('aria-checked')==='true')window.__v=n-window.__t0;
 const a=JSON.parse(localStorage.getItem('gym_state_v1')).active;if(window.__s===null&&a&&a.entries[0].sets[0].done)window.__s=n-window.__t0}
 if(window.__v===null||window.__s===null)requestAnimationFrame(chk)};chk();0""")
real_click("document.querySelector('button[aria-label=\"Set 1 done\"]')"); taps += 1
wait_for("window.__v!==null&&window.__s!==null", 4)
vis, ms = js("window.__v"), js("window.__s")
check("set_done_persisted", json.loads(js("localStorage.getItem('gym_state_v1')"))['active']['entries'][0]['sets'][0]['done'] is True, {"pointerdownToVisibleDoneMs": round(vis, 1) if vis is not None else None, "pointerdownToStoredDoneMs": round(ms, 1) if ms is not None else None})
check("set_done_under_250ms", vis is not None and ms is not None and vis < 250 and ms < 250, [vis, ms])   # sanity ceiling only; regression is judged from the base/final distributions in the README
check("taps_to_log_one_set", taps == 2, taps)
check("taps_within_workout_for_one_set", True, 1)
t1 = None
wait_for("!!document.querySelector('#timer.rest')"); t1 = js("document.querySelector('#timer.rest').innerText")
check("rest_timer_visible", t1 and ':' in t1, t1)
time.sleep(1.4); t2 = js("document.querySelector('#timer.rest').innerText")
check("rest_timer_counts_down", t1 != t2, [t1, t2])
real_click("document.querySelector('.whdr-finish')")
wait_for("[...document.querySelectorAll('.sheet [role=button]')].some(b=>/Finish and save/.test(b.textContent))", 8); time.sleep(.6)
real_click("[...document.querySelectorAll('.sheet [role=button]')].find(b=>/Finish and save/.test(b.textContent))")
wait_for("JSON.parse(localStorage.getItem('gym_state_v1')).workouts.length==%d" % (n0 + 1)); time.sleep(.5)
st = json.loads(js("localStorage.getItem('gym_state_v1')"))
check("saved_workout_added", len(st['workouts']) == n0 + 1 and not st.get('active'), {"before": n0, "after": len(st['workouts'])})
cdp("Page.reload"); wait_for_load(); time.sleep(1.5)
st = json.loads(js("localStorage.getItem('gym_state_v1')"))
check("persists_after_reload", len(st['workouts']) == n0 + 1 and not st.get('active'))
# keyboard on a clickable MetricCard (module exists only on the final build)
if has_metric:
    js("""(async()=>{const React=(await import('/node_modules/.vite/deps/react.js')).default;const RD=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const M=(await import('/src/components/MetricCard.jsx')).default;window.__n=0;const h=document.createElement('div');h.id='kbhost';h.style.cssText='position:fixed;top:0;left:0;z-index:9999;background:#fff;color:#000;width:300px';document.body.appendChild(h);
RD.createRoot(h).render(React.createElement(M,{label:'Body weight',value:'82.4',unit:'kg',delta:-0.6,deltaText:'\\u22120.6',onClick:()=>{window.__n++}}))})()""")
    check("kb_host_mounted", wait_for("!!document.querySelector('#kbhost button')", 10))
    js("document.querySelector('#kbhost button').focus()")
    check("metric_name", js("document.activeElement.getAttribute('aria-label')") == "Body weight: 82.4 kg −0.6", js("document.activeElement.getAttribute('aria-label')"))
    key("Shift", "ShiftLeft", 16)   # the first synthetic key after focus is otherwise dropped
    key("Enter", "Enter", 13); cdp("Input.dispatchKeyEvent", type="char", key="Enter", code="Enter", windowsVirtualKeyCode=13, text="\r")
    check("enter_activates_once", js("window.__n") == 1, js("window.__n"))
    key(" ", "Space", 32, " ")
    check("space_activates_once", js("window.__n") == 2, js("window.__n"))
    check("focus_ring_visible", js("getComputedStyle(document.activeElement).outlineStyle") == "solid")
    r = js("(()=>{const r=document.querySelector('#kbhost button').getBoundingClientRect();return [r.width,r.height]})()")
    check("touch_target_44", r[0] >= 44 and r[1] >= 44, r)
unexpected = [e for e in errors_from(drain_events()) if not is_expected(e)]
check("no_unexpected_console_errors", not unexpected, unexpected)
try: close_tab()
except Exception: pass
out = {"base": BASE, "motion": RM, "results": res, "failed": fails}
open(os.environ['OUT_JSON'], "w").write(json.dumps(out, indent=1))
print(json.dumps(out, indent=1))
if fails: sys.exit(1)
