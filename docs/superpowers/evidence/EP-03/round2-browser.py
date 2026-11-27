"""I2 rising-load proof using the round1 harness, same isolated ports/media block.
Run with BU_NAME=ep03r2 BU_CDP_URL=http://127.0.0.1:9323 BH_TAB_MARKER=0
browser-harness < docs/superpowers/evidence/EP-03/round2-browser.py
"""
from pathlib import Path

source = Path('/code/openGym-fork/docs/superpowers/evidence/EP-03/round1-browser.py').read_text()

def adapt(old, new):
    global source
    assert source.count(old) == 1, old
    source = source.replace(old, new)

begin = source.index('cases = [')
end = source.index('\n\nnew_tab', begin)
source = source[:begin] + '''
def rising(extra):
    return "[30,40,80].map((load,i)=>session('rise'+i,'2026-11-'+(12+i),[entry(load,5,{id:'0017',"+extra+"})],{bw:80}))"
cases = [
    ('target-false-rising', 'en', rising('target:{mode:"reps",assisted:false}'), True),
    ('entry-false-rising', 'en', rising('assisted:false'), True),
]
''' + source[end:]
adapt("base_seed.replace('THEME',", "base_seed.replace(\"unit:'kg'\", \"volumeBodyweight:true,unit:'kg'\").replace('THEME',")
adapt("('round1-' + name", "('round2-' + name")
adapt("'round1-browser.json'", "'round2-browser.json'")
adapt("len(result['rows']) == 2", "len(result['rows']) == 3")
adapt("[['1','250'],['1','200']]", "[['1','150'],['1','200'],['1','400']]")
adapt("'Included 2 sessions; excluded 1:'", "'Included 3 sessions; excluded 0:'")
exec(compile(source, 'round2-browser-expanded.py', 'exec'))
