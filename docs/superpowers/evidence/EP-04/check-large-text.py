# Execute through browser-harness on the nutrition route with the synthetic fixture.
exec(open('docs/superpowers/evidence/EP-04/browser-helpers.py').read())
go('nutrition')
cdp('Emulation.setDeviceMetricsOverride',width=320,height=900,deviceScaleFactor=1,mobile=False)
js("document.documentElement.style.fontSize='200%'")
time.sleep(.3)
lines=js("[...document.querySelectorAll('.nutrition-summary .metric-v')].map(e=>{const r=document.createRange();r.selectNodeContents(e);return {text:e.textContent,lines:r.getClientRects().length}})")
print(lines)
assert all(x['lines']==1 for x in lines), 'ordinary daily totals must remain readable on one line at 200% text'
assert js('document.documentElement.scrollWidth<=innerWidth')
shot('diary-rtl-200percent-320.png',320)
