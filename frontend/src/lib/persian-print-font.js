// The native print views have no asset base URL. Embed the font only when printing
// Persian, keeping the document self-contained and the font out of the main JS bundle.
import font from '../fonts/Vazirmatn-VF.woff2?inline'

export function withPersianPrintFont(html) {
  return html.replace('</head>', `<style>
@font-face{font-family:Vazirmatn;src:url("${font}") format('woff2');font-weight:100 900;font-style:normal;font-display:swap}
body{font-family:Vazirmatn,sans-serif}
@page{@bottom-left{font-family:Vazirmatn,sans-serif}@bottom-right{font-family:Vazirmatn,sans-serif}}
</style></head>`)
}
