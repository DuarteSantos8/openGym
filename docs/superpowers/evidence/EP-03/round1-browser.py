"""Run through browser-harness, own localhost API 33103/Vite 5177/CDP 9323.
Reuses the committed synthetic seed; no real profile or exercise media.
"""
import base64
import json
from pathlib import Path

OUT = Path('/code/openGym-fork/docs/superpowers/evidence/EP-03')
base_seed = (OUT / 'browser-qa.py').read_text().split('seed = r"""')[1].split('""".replace')[0]
results = []

def tab_to(predicate, backwards=False):
    for count in range(150):
        if js(predicate):
            return count
        press_key('Tab', modifiers=8 if backwards else 0)
    raise AssertionError('Keyboard target not reachable: ' + predicate)

def shot(name):
    press_key('Home', modifiers=2)
    cdp('Runtime.evaluate', expression='new Promise(r=>setTimeout(r,600))', awaitPromise=True)
    for _ in range(100):
        if js("document.querySelector('[data-tour=stats-records]').getBoundingClientRect().top <= 120"):
            break
        press_key('ArrowDown')
        cdp('Runtime.evaluate', expression='new Promise(r=>setTimeout(r,100))', awaitPromise=True)
    path = OUT / ('round1-' + name + '.png')
    path.write_bytes(base64.b64decode(cdp('Page.captureScreenshot', format='png', captureBeyondViewport=False)['data']))
    return path.name

ordinary = "session('ordinary','2026-11-10',[entry(50)])"
target = "session('target','2026-11-14',[entry(30,5,{target:{mode:'reps',assisted:true}})])"
direct = "session('entry','2026-11-14',[entry(30,5,{assisted:true})])"
returned = "[session('ordinary','2026-11-10',[entry(50)]),session('target','2026-11-12',[entry(30,5,{target:{assisted:true}})]),session('mixed','2026-11-14',[entry(20,5,{assisted:true}),entry(40)])]"
cases = [
    ('target-only', 'en', '['+target+']', False),
    ('entry-only', 'en', '['+direct+']', False),
    ('target-latest', 'en', '['+ordinary+','+target+']', False),
    ('entry-latest', 'en', '['+ordinary+','+direct+']', False),
    ('mixed-return', 'en', returned, True),
    ('volume-ar-rtl-320', 'ar', returned, True),
]

new_tab('about:blank')
cdp('Network.enable')
cdp('Runtime.enable')
cdp('Log.enable')
cdp('Network.setBlockedURLs', urls=['*exercise-media*'])
cdp('Emulation.setDeviceMetricsOverride', width=320, height=1000, deviceScaleFactor=1, mobile=False)
cdp('Emulation.setEmulatedMedia', features=[{'name':'prefers-reduced-motion','value':'reduce'}])

for name, lang, workouts, eligible in cases:
    goto_url('about:blank')
    drain_events()
    seed = base_seed.replace('THEME', '"light"').replace("lang:'en'", 'lang:'+json.dumps(lang))
    seed = seed.replace('localStorage.clear();', 'S.workouts = '+workouts+'; localStorage.clear();')
    sid = cdp('Page.addScriptToEvaluateOnNewDocument', source=seed)['identifier']
    goto_url('http://localhost:5177/#/stats?section=lifts')
    wait_for_load()
    assert wait_for_element('[data-tour=stats-records]', timeout=20)
    cdp('Page.removeScriptToEvaluateOnNewDocument', identifier=sid)
    labels = cdp('Runtime.evaluate', expression="import('/src/lib/i18n.js').then(({t})=>({chart:t('Chart'),volume:t('Volume')}))", awaitPromise=True, returnByValue=True)['result']['value']
    chart_pred = "document.activeElement?.querySelector('.lrow-t')?.textContent === "+json.dumps(labels['chart'])
    has_picker = js("[...document.querySelectorAll('[data-tour=stats-records] button .lrow-t')].some(e=>e.textContent === "+json.dumps(labels['chart'])+")")
    options = []
    if has_picker:
        tab_to(chart_pred)
        press_key('Enter')
        assert wait_for_element('.sheet h3', timeout=5)
        options = js("[...document.querySelectorAll('.sheet .sect-b button')].map(b=>b.textContent.trim())")
    assert (labels['volume'] in options) == eligible, (name, options)
    if eligible:
        tab_to("document.activeElement?.closest('.sheet') && document.activeElement?.textContent.trim() === "+json.dumps(labels['volume']), backwards=True)
        press_key('Enter')
        assert wait_for_element('table caption', timeout=5)
        tab_to("document.activeElement?.closest('[data-tour=stats-records]') && document.activeElement?.textContent === '1W'")
        press_key('Enter')
    elif has_picker:
        press_key('Escape')
    result = js("""(()=>{
      const c=document.querySelector('[data-tour=stats-records]');
      return {lang:document.documentElement.lang,dir:document.documentElement.dir,
        viewport:innerWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth,
        cardOverflow:c.scrollWidth>c.clientWidth,tableDirection:c.querySelector('table') ? getComputedStyle(c.querySelector('table')).direction : null,
        caption:c.querySelector('caption')?.textContent,
        rows:[...c.querySelectorAll('tbody tr')].map(r=>[...r.children].map(x=>x.textContent)),
        note:c.querySelector('p.ex-note')?.textContent,
        chartSvgCount:c.querySelectorAll('.chart svg').length,
        focusVisible:document.activeElement.matches(':focus-visible'),
        clippedRanges:[...c.querySelectorAll('.seg-range button')].some(b=>b.scrollWidth>b.clientWidth),
        media:[...document.querySelectorAll('img,video')].map(e=>e.currentSrc||e.src).filter(s=>s.includes('exercise-media'))};
    })()""")
    result.update({'case':name,'eligible':eligible,'pickerOptions':options})
    assert not result['documentOverflow'] and not result['cardOverflow'] and not result['clippedRanges']
    assert not result['media']
    if eligible:
        assert len(result['rows']) == 2 and result['chartSvgCount'] > 0
        assert result['focusVisible']
        if lang == 'en':
            assert [r[1:] for r in result['rows']] == [['1','250'],['1','200']]
            assert 'Included 2 sessions; excluded 1:' in result['note']
        else:
            assert result['dir'] == result['tableDirection'] == 'rtl'
            assert result['lang'] == 'ar'
            assert 'حجم' in result['caption'] and 'استُبعدت' in result['note']
            assert all('250' in str(r) or '200' in str(r) or '٢٥٠' in str(r) or '٢٠٠' in str(r) for r in result['rows'])
        ax = cdp('Accessibility.getFullAXTree')['nodes']
        result['tableRoles'] = [{'role':n.get('role',{}).get('value'),'name':n.get('name',{}).get('value')} for n in ax if n.get('role',{}).get('value') in ['table','columnheader','rowheader']]
    else:
        assert not result['rows']
    result['screenshot'] = shot(name)
    events = drain_events()
    result['consoleErrors'] = [e['params'] for e in events if e['method']=='Runtime.exceptionThrown' or (e['method']=='Runtime.consoleAPICalled' and e['params'].get('type')=='error') or (e['method']=='Log.entryAdded' and e['params']['entry']['level']=='error')]
    result['failedRequests'] = [{'method':e['method'],'url':e['params'].get('response',{}).get('url'),'status':e['params'].get('response',{}).get('status'),'error':e['params'].get('errorText')} for e in events if e['method']=='Network.loadingFailed' or (e['method']=='Network.responseReceived' and e['params']['response']['status']>=400)]
    results.append(result)
    (OUT / 'round1-browser.json').write_text(json.dumps(results, indent=2, ensure_ascii=False)+'\n')
    print(json.dumps({'case':name,'eligible':eligible,'rows':result['rows'],'screenshot':result['screenshot'],'failedRequests':result['failedRequests']}, ensure_ascii=False))
