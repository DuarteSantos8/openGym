// syntax.test.js holds core.js to a list of ES5 methods; this holds the other watch files to one too, so a
// built-in the deny-list never heard of cannot slip in. Besides the ES5 ones, only the page's own names
// and Huawei's documented API calls may follow a dot.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strip } from './syntax.test.js'

const root = new URL('../entry/src/main/js/MainAbility/', import.meta.url)
const es5 = 'forEach map filter some every indexOf lastIndexOf slice concat push pop shift unshift splice sort reverse join keys isArray stringify parse floor ceil round max min abs charAt charCodeAt substring split replace test toString toLowerCase toUpperCase call'.split(' ')
const own = 'onError onComplete accept busy gathering listen stop save load send registerReceiver unregisterReceiver readText writeText delete buzz now random'.split(' ')
const huawei = 'getInfo setDescription vibrate subscribeHeartRate unsubscribeHeartRate setKeepScreenOn $t setPeerPkgName setPeerFingerPrint terminate rotation'.split(' ')

;['common/frames.js', 'common/radio.js', 'common/store.js', 'common/view.js', 'pages/index/index.js'].forEach(f => {
  test(f + ' calls only ES5 methods, its own names and Huawei\'s documented calls', () => {
    const src = strip(readFileSync(new URL(f, root), 'utf8'))
    const called = []
    src.replace(/\.\s*([A-Za-z_$][\w$]*)\s*\(/g, (m, name) => { called.push(name) })
    assert.deepEqual(called.filter(n => es5.indexOf(n) < 0 && own.indexOf(n) < 0 && huawei.indexOf(n) < 0), [])
    const globals = []
    src.replace(/\b(Math|Object|Array|JSON|Number|String|Date)\.([A-Za-z_$][\w$]*)/g, (m, a, b) => { globals.push(a + '.' + b) })
    const ok = ['Math.floor', 'Math.ceil', 'Math.round', 'Math.max', 'Math.min', 'Math.abs', 'Math.random', 'Object.keys', 'Object.prototype', 'Array.isArray', 'JSON.stringify', 'JSON.parse', 'Date.now']
    assert.deepEqual(globals.filter(g => ok.indexOf(g) < 0), [])
  })
})
