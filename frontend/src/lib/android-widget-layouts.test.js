// #981: the Android widget said "Unable to load widget" once it was stretched wide. A widget is
// drawn by the launcher from RemoteViews, which inflate only a short list of classes, and the
// wide layout's divider was a plain View. Every widget layout is held to that list here, and the
// provider hands Android 12+ all its shapes at once.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const res = new URL('../../android/app/src/main/res/', import.meta.url)
// developer.android.com/develop/ui/views/appwidgets/layouts (RemoteViews-supported classes).
const ALLOWED = new Set(['FrameLayout', 'LinearLayout', 'RelativeLayout', 'GridLayout', 'AnalogClock', 'Button', 'Chronometer',
  'ImageButton', 'ImageView', 'ProgressBar', 'TextView', 'ViewFlipper', 'ListView', 'GridView', 'StackView', 'AdapterViewFlipper',
  'ViewStub', 'CheckBox', 'RadioButton', 'RadioGroup', 'Switch', 'merge', 'include'])

describe('the Android widget (#981)', () => {
  const layouts = readdirSync(new URL('layout/', res)).filter(f => f.startsWith('widget_'))
  it('has its layouts (three shapes, the set logger in two and the picker preview, v1.4.5)', () => {
    expect(layouts.sort()).toEqual(['widget_logger.xml', 'widget_logger_row.xml', 'widget_medium.xml', 'widget_preview.xml', 'widget_row.xml', 'widget_small.xml'])
  })
  it('the widget picker shows the preview with numbers, not an empty widget (Android 12+)', () => {
    const info = readFileSync(new URL('xml/opengym_widget_info.xml', res), 'utf8')
    expect(info).toMatch(/android:previewLayout="@layout\/widget_preview"/)
    expect(readFileSync(new URL('layout/widget_preview.xml', res), 'utf8')).toMatch(/android:text="12"/)
  })
  it.each(layouts)('%s holds only what RemoteViews can inflate', f => {
    const xml = readFileSync(new URL('layout/' + f, res), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    const tags = [...xml.matchAll(/<([A-Za-z][\w.]*)[\s/>]/g)].map(m => m[1])
    expect(tags.filter(t => !ALLOWED.has(t))).toEqual([])
  })
  it('the provider gives Android 12+ every shape, sized like its layouts', () => {
    const java = readFileSync(new URL('../java/ch/duartesantos/opengym/OpenGymWidgetProvider.java', res), 'utf8')
    expect(java).toMatch(/new RemoteViews\(shapes\)/)
    expect(java.match(/shapes\.put\(new SizeF/g)).toHaveLength(3)
    const info = readFileSync(new URL('xml/opengym_widget_info.xml', res), 'utf8')
    expect(Number(/minResizeWidth="(\d+)dp"/.exec(info)[1])).toBeGreaterThanOrEqual(Number(/ROW_MIN_W = (\d+)/.exec(java)[1]))
    expect(Number(/minResizeHeight="(\d+)dp"/.exec(info)[1])).toBeGreaterThanOrEqual(Number(/ROW_MIN_H = (\d+)/.exec(java)[1]))
  })
  it('the configure screen is not a narrow column', () => {
    const java = readFileSync(new URL('../java/ch/duartesantos/opengym/OpenGymWidgetConfigure.java', res), 'utf8')
    expect(java).toMatch(/getWindow\(\)\.setLayout\(/)
  })
})
