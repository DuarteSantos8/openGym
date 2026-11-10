// openGym for Zepp OS: the app itself holds nothing but the messaging to the Side Service (zml).
import { BaseApp } from '@zeppos/zml/base-app'

App(BaseApp({ globalData: {}, onCreate () {}, onDestroy () {} }))
