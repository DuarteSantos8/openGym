# Run inside browser-harness with an isolated BU_NAME/BU_CDP_URL. Synthetic local server only.
import os, json, time, pathlib, base64
OUT = pathlib.Path('docs/superpowers/evidence/EP-04')
def wait(expr, seconds=10):
    end=time.time()+seconds
    while time.time()<end:
        if js(expr): return True
        time.sleep(.1)
    raise AssertionError(expr)
def state(): return json.loads(js("localStorage.getItem('gym_state_v1')"))
def visible():
    s=state(); gone=s.get('deleted',{}).get('nutritionEntries',{})
    return [e for e in s.get('nutritionEntries',[]) if gone.get(e['id'],0)<=0]
def go(path):
    goto_url('http://localhost:5144/#/'+path); wait_for_load(); time.sleep(.35)
def key(k, code=None, vk=None):
    args={'key':k,'code':code or k}
    if vk: args['windowsVirtualKeyCode']=vk
    cdp('Input.dispatchKeyEvent',type='keyDown',**args)
    if k=='Enter': cdp('Input.dispatchKeyEvent',type='char',text='\r',**args)
    cdp('Input.dispatchKeyEvent',type='keyUp',**args)
def click_name(name, role='button'):
    nodes=cdp('Accessibility.getFullAXTree')['nodes']
    matches=[n for n in nodes if n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name]
    assert matches, (name,[(n.get('role',{}).get('value'),n.get('name',{}).get('value')) for n in nodes if n.get('role',{}).get('value') in ['button','link','switch']])
    node=matches[0]['backendDOMNodeId']; cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    time.sleep(.4)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content']
    h=js('innerHeight')
    if sum(q[1::2])/4>h-110:
        cdp('Input.dispatchMouseEvent',type='mouseWheel',x=sum(q[0::2])/4,y=h/2,deltaX=0,deltaY=250); time.sleep(.4)
        q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content']
    click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4); time.sleep(.3)
def fill(name,value):
    selector='[name='+json.dumps(name)+']'
    node=cdp('DOM.querySelector',nodeId=cdp('DOM.getDocument')['root']['nodeId'],selector=selector)['nodeId']
    cdp('DOM.scrollIntoViewIfNeeded',nodeId=node)
    cdp('DOM.focus',nodeId=node)
    cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',modifiers=2,windowsVirtualKeyCode=65)
    cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',modifiers=2,windowsVirtualKeyCode=65)
    cdp('Input.insertText',text=str(value))
def shot(name,width=390):
    cdp('Emulation.setDeviceMetricsOverride',width=width,height=900,deviceScaleFactor=1,mobile=False)
    time.sleep(.25)
    assert js('document.documentElement.scrollWidth <= innerWidth'), 'horizontal overflow'
    data=cdp('Page.captureScreenshot',format='png',captureBeyondViewport=False)['data']
    (OUT/name).write_bytes(base64.b64decode(data))
def record(name,detail):
    path=OUT/'browser-results.json'
    results=json.loads(path.read_text()) if path.exists() else {}
    results[name]=detail; path.write_text(json.dumps(results,indent=2))
