from pathlib import Path
s=Path('/tmp/opengym-review/combined-browser.py').read_text()
exec(s[:s.index("new_tab('about:blank')")])
def tab_to(predicate, backwards=False):
    for _ in range(150):
        if js(predicate): return
        press_key('Tab', modifiers=8 if backwards else 0)
    raise AssertionError(predicate)
before=visible()
click_name('Nutrition diary','switch')
wait("JSON.parse(localStorage.getItem('gym_state_v1')).modules.nutrition===false")
goto_url('http://localhost:5179/#/nutrition');wait_for_load()
assert not js("!!document.querySelector('.nutrition-lookup')")
assert visible()==before
assert len(outbound())==2
record('module_off',{'rows_preserved':2,'lookup_hidden':True,'extra_provider_calls':0})
click_name('Stats')
wait("!!document.querySelector('[data-tour=stats-records]')")
tab_to("document.activeElement?.querySelector('.lrow-t')?.textContent === 'Chart'")
press_key('Enter')
wait("!!document.querySelector('.sheet h3')")
tab_to("document.activeElement?.closest('.sheet') && document.activeElement?.textContent.trim() === 'Volume'",True)
press_key('Enter')
wait("!!document.querySelector('[data-tour=stats-records] table caption')")
tab_to("document.activeElement?.closest('[data-tour=stats-records]') && document.activeElement?.textContent === '1W'")
press_key('Enter')
rows=js("[...document.querySelectorAll('[data-tour=stats-records] tbody tr')].map(r=>[...r.children].map(e=>e.textContent))")
assert [r[1:] for r in rows]==[['1','150'],['1','200'],['1','400']],rows
assert js("!!document.querySelector('[data-tour=stats-records] .chart svg')")
assert not js("document.documentElement.scrollWidth>innerWidth")
record('stats_with_nutrition_off',{'rows':rows,'range':'1W','volumeBodyweight':True,'saved_assisted_override':False,'chart_present':True,'no_horizontal_overflow':True})
click_name('Start')
time.sleep(.4)
print(js("({hash:location.hash,active:!!JSON.parse(localStorage.getItem('gym_state_v1')).active,text:document.body.innerText.slice(-1800)})"))
