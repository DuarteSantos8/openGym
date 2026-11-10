// An exercise's QR sheet as a one-page A4 PDF, for the app on an iPhone's home screen.
//
// There, window.print() does nothing at all: a home-screen web app has no Safari around it to
// host the print sheet, from a frame or from the page itself. What it does have is the share
// sheet, whose "Print" prints a PDF at its real size. So the page is drawn onto a canvas here at
// 200 dpi — the same parts as exerciseQrPrintHTML: name, tags, picture, description, steps and
// the code at exactly 3 × 3 cm — and wrapped as a JPEG in the smallest PDF that holds one picture.
// No library: a PDF of one image is a few lines of text around the JPEG's bytes.
//
// Everything here is pure or takes the canvas context it draws on, so it is tested without a
// browser (print-sheet.test.js).

export const A4_MM = { w: 210, h: 297 }
export const SHEET_DPI = 200
export const PX_PER_MM = SHEET_DPI / 25.4
const PT_PER_MM = 72 / 25.4

/** The home-screen app on an iPhone or iPad: Safari's own flag, set nowhere else. */
export const iosHomeScreenApp = (nav = globalThis.navigator) => nav?.standalone === true

/**
 * `text` broken into lines no wider than `maxWidth`, by words, as `measure(str)` measures them;
 * a word wider than the line on its own is broken by characters.
 */
export function wrapText(text, maxWidth, measure) {
  const out = []
  for (const para of String(text || '').split(/\n+/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word
      if (measure(next) <= maxWidth) { line = next; continue }
      if (line) out.push(line)
      if (measure(word) <= maxWidth) { line = word; continue }
      // One word longer than the line: as many characters as fit, then the rest.
      let part = ''
      for (const ch of word) {
        if (measure(part + ch) > maxWidth && part) { out.push(part); part = '' }
        part += ch
      }
      line = part
    }
    if (line) out.push(line)
  }
  return out
}

/**
 * Draws the sheet onto `ctx`, a canvas of A4 at SHEET_DPI. `qr` is a canvas of the code (one
 * pixel per module, drawn up to 30 mm with no smoothing); `picture` an image already loaded, or
 * null. Text that would run past the bottom margin stops at the last line that fits, with "…".
 * Returns where the QR code went, in pixels, so a test can hold it to 3 × 3 cm.
 */
export function drawExerciseSheet(ctx, { name, tags = [], description = '', steps = [], qr, picture, labels = {}, rtl = false }) {
  const mm = v => Math.round(v * PX_PER_MM)
  const W = mm(A4_MM.w), H = mm(A4_MM.h)
  const left = mm(15), right = W - mm(15), bottom = H - mm(15)
  const font = (sizeMm, weight = 400) => `${weight} ${mm(sizeMm)}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'top'
  ctx.direction = rtl ? 'rtl' : 'ltr'

  // The code, top right (top left in a right-to-left language), and its caption under it.
  const qrSize = mm(30)
  const qrBox = { x: rtl ? left : right - qrSize, y: mm(15), size: qrSize }
  let qrBottom = qrBox.y
  if (qr) {
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(qr, qrBox.x, qrBox.y, qrSize, qrSize)
    ctx.imageSmoothingEnabled = true
    ctx.fillStyle = '#6b7180'
    ctx.font = font(2.4)
    ctx.textAlign = 'center'
    let y = qrBox.y + qrSize + mm(1.5)
    for (const line of wrapText(labels.caption || '', qrSize, s => ctx.measureText(s).width)) {
      ctx.fillText(line, qrBox.x + qrSize / 2, y)
      y += mm(3)
    }
    qrBottom = y
  }

  // Name, tags: the column left of the code.
  const textLeft = rtl ? left + qrSize + mm(8) : left
  const textRight = rtl ? right : right - (qr ? qrSize + mm(8) : 0)
  const width = textRight - textLeft
  const x = rtl ? textRight : textLeft
  ctx.textAlign = rtl ? 'right' : 'left'
  let y = mm(15)
  ctx.fillStyle = '#6a7a3a'
  ctx.font = font(3, 700)
  ctx.fillText('OPENGYM', x, y)
  y += mm(5)
  ctx.fillStyle = '#16181d'
  ctx.font = font(8, 700)
  for (const line of wrapText(name, width, s => ctx.measureText(s).width)) { ctx.fillText(line, x, y); y += mm(9.5) }
  // Capitalised word by word, as the HTML sheet's CSS does (text-transform: capitalize).
  const tagLine = tags.filter(Boolean).map(tg => String(tg).replace(/(^|\s)(\p{Ll})/gu, (m, sp, c) => sp + c.toLocaleUpperCase())).join(' · ')
  if (tagLine) {
    ctx.fillStyle = '#6b7180'
    ctx.font = font(4)
    for (const line of wrapText(tagLine, width, s => ctx.measureText(s).width)) { ctx.fillText(line, x, y); y += mm(5.5) }
  }
  y = Math.max(y, qrBottom) + mm(3)
  ctx.fillStyle = '#16181d'
  ctx.fillRect(left, y, right - left, Math.max(2, mm(0.5)))
  y += mm(7)

  // The picture, centred, at most 90 × 95 mm.
  if (picture && picture.width > 0 && picture.height > 0) {
    const scale = Math.min(mm(90) / picture.width, mm(95) / picture.height)
    const pw = Math.round(picture.width * scale), ph = Math.round(picture.height * scale)
    ctx.drawImage(picture, Math.round((W - pw) / 2), y, pw, ph)
    y += ph + mm(7)
  }

  // Description and steps over the full width, as far as the page goes.
  const x2 = rtl ? right : left
  const full = right - left
  let cut = false
  const lines = (text, sizeMm, lead, color, { weight = 400, more = false } = {}) => {
    if (cut) return
    ctx.fillStyle = color
    ctx.font = font(sizeMm, weight)
    const all = wrapText(text, full, s => ctx.measureText(s).width)
    for (let i = 0; i < all.length; i++) {
      if (y + mm(lead) > bottom) { cut = true; return }
      // The last line that fits, with more to come: it ends with "…" and the page ends there.
      const last = (i < all.length - 1 || more) && y + 2 * mm(lead) > bottom
      ctx.fillText(last ? all[i] + ' …' : all[i], x2, y)
      y += mm(lead)
      if (last) { cut = true; return }
    }
  }
  const stepList = steps.map(s => String(s || '').trim()).filter(Boolean)
  if (description) { lines(description, 4.2, 6, '#16181d', { more: stepList.length > 0 }); y += mm(4) }
  if (stepList.length) {
    lines(String(labels.howTo || '').toUpperCase(), 3.2, 5.5, '#8a90a0', { weight: 700, more: true })
    stepList.forEach((step, i) => { lines(`${i + 1}. ${step}`, 4, 5.8, '#16181d', { more: i < stepList.length - 1 }); y += mm(1.2) })
  }
  return { qr: qrBox, width: W, height: H }
}

const enc = s => new TextEncoder().encode(s)

/**
 * The smallest PDF that shows one JPEG over a whole A4 page. `jpeg` is the file's bytes; `w`/`h`
 * its size in pixels. The page is A4 in points, so a picture drawn at SHEET_DPI prints at size.
 */
export function jpegPdf(jpeg, w, h, { pageWidthPt = A4_MM.w * PT_PER_MM, pageHeightPt = A4_MM.h * PT_PER_MM } = {}) {
  const pw = pageWidthPt.toFixed(2), ph = pageHeightPt.toFixed(2)
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q\n`
  const parts = []
  const offsets = []
  let length = 0
  const push = bytes => { parts.push(bytes); length += bytes.length }
  const obj = (n, head, stream) => {
    offsets[n] = length
    push(enc(`${n} 0 obj\n${head}\n`))
    if (stream) { push(enc('stream\n')); push(stream); push(enc('\nendstream\n')) }
    push(enc('endobj\n'))
  }
  push(enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'))
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg)
  const body = enc(content)
  obj(5, `<< /Length ${body.length} >>`, body)
  const xref = length
  const rows = offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  push(enc(`xref\n0 6\n0000000000 65535 f \n${rows}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`))
  const out = new Uint8Array(length)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
