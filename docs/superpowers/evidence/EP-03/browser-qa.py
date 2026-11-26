"""Run via BU_CDP_URL=http://127.0.0.1:9323 browser-harness < this-file.
EP03_WIDTH (320/390/1280), EP03_THEME (dark/light), EP03_MOTION (reduce/no-preference).
Synthetic guest only; own browser profile, API DATA_DIR and localhost Vite required.
"""
import base64
import json
import os
from pathlib import Path

OUT = Path('/code/openGym-fork/docs/superpowers/evidence/EP-03')
width = int(os.environ.get('EP03_WIDTH', '320'))
theme = os.environ.get('EP03_THEME', 'dark')
motion = os.environ.get('EP03_MOTION', 'reduce')
name = f'{theme}-{width}' + ('-motion' if motion != 'reduce' else '')
events = []

def collect():
    events.extend(drain_events())

def tab_to(predicate, backwards=False):
    for count in range(120):
        if js(predicate):
            return count
        press_key('Tab', modifiers=8 if backwards else 0)
    raise AssertionError('Keyboard target was not reachable: ' + predicate)

def shot(suffix):
    # Scroll using real keys and capture the viewport, including the fixed tab bar.
    # Off-viewport clipping can paint that bar across a table which is not obscured
    # when the card is actually in view.
    press_key('Home', modifiers=2)
    cdp('Runtime.evaluate', expression='new Promise(r=>setTimeout(r,600))', awaitPromise=True)
    for _ in range(100):
        if js("document.querySelector('[data-tour=stats-records]').getBoundingClientRect().top <= 140"):
            break
        press_key('ArrowDown')
        cdp('Runtime.evaluate', expression='new Promise(r=>setTimeout(r,200))', awaitPromise=True)
    data = cdp('Page.captureScreenshot', format='png', captureBeyondViewport=False)['data']
    path = OUT / f'{suffix}-{name}.png'
    path.write_bytes(base64.b64decode(data))
    return path.name

# The caller starts/reuses its own tab. Block before the first real navigation.
if current_tab()['url'] != 'about:blank' and 'localhost:5177' not in current_tab()['url']:
    new_tab('about:blank')
goto_url('about:blank')  # A fresh document also resets keyboard focus on repeated runs.
cdp('Network.enable')
cdp('Runtime.enable')
cdp('Log.enable')
cdp('Network.setBlockedURLs', urls=['*exercise-media*'])
cdp('Emulation.setDeviceMetricsOverride', width=width, height=1200 if width==1280 else 1000, deviceScaleFactor=1, mobile=False)
cdp('Emulation.setEmulatedMedia', features=[{'name':'prefers-reduced-motion','value':motion}])
drain_events()  # Only this invocation's navigation and keyboard interactions.

seed = r"""
if (location.hostname === 'localhost') {
  Date.now = () => new Date(2026, 10, 14, 16).getTime();
  const at = (d, h=12) => new Date(d + 'T' + String(h).padStart(2,'0') + ':00:00').getTime();
  const entry = (w=50,r=5,extra={}) => ({id:'0025',target:{id:'0025',mode:'reps'},sets:[{w,r,done:true}],...extra});
  const session = (id,d,entries,extra={}) => ({id,d,start:at(d),end:at(d,13),name:'Synthetic strength',entries,prs:[],...extra});
  const S = {
    unit:'kg', theme:THEME, lang:'en', body:'male', effort:'none', routines:[], exWeights:{},
    modules:{motivation:false,seasonal:false,coach:false,strength:false},
    bodyweight:[{d:'2026-10-01',w:80},{d:'2026-11-12',w:79},{d:'2026-11-14',w:79.5}],
    workouts:[
      session('old','2026-10-01',[entry(40)]),
      {id:'legacy',d:'2026-11-10',name:'Synthetic legacy',vol:9000,prs:[]},
      session('timed','2026-11-11',[entry(50,5,{target:{mode:'time'},sets:[{w:50,r:5,sec:30,done:true}]})]),
      session('unfinished','2026-11-12',[entry(50,5,{sets:[{w:50,r:5,done:false}]})]),
      session('am','2026-11-13',[entry(50,5,{sets:[{w:50,r:5,done:true,at:at('2026-11-13')+60000}]})]),
      session('pm','2026-11-13',[entry(50,5,{sets:[{w:50,r:5,done:true,type:'dropset',drops:[{w:40,r:3}]}]}),entry(30,4)],{start:at('2026-11-13',18),end:at('2026-11-13',19)}),
      {id:'day-only',d:'2026-11-14',name:'Synthetic d-only',entries:[entry(60)],prs:[]}
    ]
  };
  localStorage.clear();
  localStorage.setItem('gym_state_v1', JSON.stringify(S));
  localStorage.setItem('gym_guest','1');
  localStorage.setItem('gym_tour_v1', JSON.stringify({offered:true,done:true}));
}
""".replace('THEME', json.dumps(theme))
seed_id = cdp('Page.addScriptToEvaluateOnNewDocument', source=seed)['identifier']
goto_url('http://localhost:5177/#/stats?section=lifts')
wait_for_load()
assert wait_for_element('[data-tour="stats-records"]', timeout=20)
cdp('Page.removeScriptToEvaluateOnNewDocument', identifier=seed_id)
collect()

before = shot('top-set')
steps = {}
steps['toChart'] = tab_to("document.activeElement?.querySelector('.lrow-t')?.textContent === 'Chart'")
press_key('Enter')
assert wait_for_element('.sheet h3', timeout=5)
steps['toVolumeShiftTab'] = tab_to("document.activeElement?.closest('.sheet') && document.activeElement?.textContent.trim() === 'Volume'", backwards=True)
press_key('Enter')
assert wait_for_element('table caption', timeout=5)
steps['to1W'] = tab_to("document.activeElement?.closest('[data-tour=stats-records]') && document.activeElement?.textContent === '1W'")
press_key('Enter')

result = js("""(()=>{
  const c=document.querySelector('[data-tour=stats-records]');
  const allRanges=[...document.querySelectorAll('.seg-range')].filter(e=>e.textContent.includes('1W'));
  return {
    theme:document.documentElement.dataset.theme, viewport:innerWidth, viewportHeight:innerHeight,
    reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
    documentOverflow:document.documentElement.scrollWidth > innerWidth,
    cardOverflow:c.scrollWidth > c.clientWidth,
    ranges:allRanges.map(e=>({text:e.textContent,overflow:e.scrollWidth>e.clientWidth,buttons:[...e.querySelectorAll('button')].map(b=>({label:b.textContent,width:b.getBoundingClientRect().width,clipped:b.scrollWidth>b.clientWidth}))})),
    caption:c.querySelector('caption').textContent,
    rows:[...c.querySelectorAll('tbody tr')].map(r=>[...r.children].map(x=>x.textContent)),
    note:c.querySelector('p.ex-note').textContent,
    focus:{text:document.activeElement.textContent,visible:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outline},
    mediaElements:[...document.querySelectorAll('img,video')].map(e=>e.currentSrc||e.src).filter(s=>s.includes('exercise-media'))
  };
})()""")
assert result['theme'] == theme
assert not result['documentOverflow'] and not result['cardOverflow']
assert all(not r['overflow'] and all(not b['clipped'] for b in r['buttons']) for r in result['ranges'])
assert [r[1:] for r in result['rows']] == [['1','250'],['2','490'],['1','300']]
assert 'Included 3 sessions; excluded 3:' in result['note']
assert result['focus']['visible']
assert not result['mediaElements']
result['screenshots'] = [before, shot('volume')]
result['keyboardTabs'] = steps
ax = cdp('Accessibility.getFullAXTree')['nodes']
result['accessibleTable'] = [{'role':n.get('role',{}).get('value'),'name':n.get('name',{}).get('value')}
    for n in ax if n.get('role',{}).get('value') in ['table','columnheader','rowheader']]
assert any(n['role']=='table' and n['name']=='Volume per session (kg)' for n in result['accessibleTable'])
if os.environ.get('EP03_EXTRA') == '1':
    cdp('Runtime.evaluate', expression="import('/src/store/useStore.js').then(({useStore})=>{const S=useStore.getState().S;useStore.setState({S:{...S,exUnit:{'0025':{unit:'lb'}}}})})", awaitPromise=True)
    assert js("document.querySelector('table caption').textContent") == 'Volume per session (lb)'
    result['pinnedRows'] = js("[...document.querySelectorAll('tbody tr')].map(r=>r.textContent)")
    result['screenshots'].append(shot('volume-lb'))
    cdp('Runtime.evaluate', expression="import('/src/store/useStore.js').then(({useStore})=>{const S=useStore.getState().S;useStore.setState({S:{...S,workouts:S.workouts.filter(w=>w.d<'2026-11-08')}})})", awaitPromise=True)
    assert js("document.querySelector('[data-tour=stats-records]').textContent.includes('No exercise volume in this period.')")
    assert js("document.querySelectorAll('tbody tr').length") == 0
    result['emptyRange'] = True
    result['screenshots'].append(shot('volume-empty'))
    cdp('Network.emulateNetworkConditions', offline=True, latency=0, downloadThroughput=0, uploadThroughput=0)
    tab_to("document.activeElement?.closest('[data-tour=stats-records]') && document.activeElement?.textContent === 'All'")
    press_key('Enter')
    assert wait_for_element('tbody tr', timeout=5)
    result['offlineAllRows'] = js("[...document.querySelectorAll('tbody tr')].map(r=>r.textContent)")
    assert len(result['offlineAllRows']) == 1
    result['screenshots'].append(shot('volume-offline'))
    cdp('Network.emulateNetworkConditions', offline=False, latency=0, downloadThroughput=-1, uploadThroughput=-1)
collect()
result['consoleErrors'] = [e['params'] for e in events if (e['method']=='Runtime.consoleAPICalled' and e['params'].get('type')=='error') or e['method']=='Runtime.exceptionThrown' or (e['method']=='Log.entryAdded' and e['params']['entry']['level']=='error')]
result['failedRequests'] = [
    {'method':e['method'], 'url':e['params'].get('response',{}).get('url'),
     'status':e['params'].get('response',{}).get('status'), 'error':e['params'].get('errorText')}
    for e in events if e['method']=='Network.loadingFailed' or (e['method']=='Network.responseReceived' and e['params']['response']['status']>=400)]
(OUT / f'browser-{name}.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['theme','viewport','reducedMotion','documentOverflow','cardOverflow','rows','focus','screenshots','consoleErrors','failedRequests']}, indent=2))
