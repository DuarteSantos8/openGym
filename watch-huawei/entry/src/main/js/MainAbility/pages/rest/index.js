// The rest page, empty until task 11: it sends the lifter home, and the home page picks the page that draws the screen
// (view-common.js pageOf never names this page yet, so nothing gets here).
import router from '@system.router'

export default {
  data: {},
  onShow: function () { router.replace({ uri: 'pages/index/index' }) }
}
