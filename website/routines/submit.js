// The submit form: reads an openGym routine link or plan file, asks the routines service what it
// makes of it (the same checks CI runs), shrinks the cover photo in the browser, and sends it all
// for review. Nothing is published until a person has looked at it.
const $ = id => document.getElementById(id)
const form = $('sub')
const api = form.dataset.api
const started = Date.now()
const MAX_PHOTO = 8 * 1024 * 1024
let source = null       // { link } or { plan }
let preview = null      // what the service read from it
let cover = null        // { type, data } after shrinking

const show = (el, text) => { el.textContent = text; el.hidden = !text }

async function post(path, body) {
  let r
  try {
    r = await fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
  } catch { throw new Error('The routines service is not answering. Check your connection and try again in a minute.') }
  let j = null
  try { j = await r.json() } catch { /* not JSON */ }
  if (!r.ok || !j?.ok) {
    const e = new Error(j?.error || (r.status === 429 ? 'That was a lot of tries. Give it an hour and try again.' : `Something went wrong on our side (${r.status}).`))
    e.problems = j?.problems || []
    throw e
  }
  return j
}

/* ------------------------------- the routine itself ------------------------------- */

function renderPreview(p) {
  const box = $('preview')
  box.replaceChildren()
  const ok = document.createElement('p')
  ok.className = 'ok'
  ok.textContent = `Read it: ${p.sessions.length === 1 ? 'one session' : p.sessions.length + ' sessions'}, ${p.exerciseCount} exercises${p.schedule.length ? `, ${p.schedule.length} days a week` : ''}.`
  box.appendChild(ok)
  for (const s of p.sessions) {
    const h = document.createElement('h3')
    h.textContent = s.name
    const ul = document.createElement('ul')
    for (const x of s.exercises) {
      const li = document.createElement('li')
      li.textContent = `${x.name}, ${x.line}`
      ul.appendChild(li)
    }
    box.append(h, ul)
  }
  box.hidden = false
  // Sensible starting values from the plan itself; everything stays editable.
  if (!form.title.value && p.name) form.title.value = p.name.slice(0, 80)
  if (!form.author.value && p.from) form.author.value = p.from
  if (p.days) form.split.value = p.guess?.split || form.split.value
}

async function readSource(next) {
  source = next
  preview = null
  show($('src-err'), '')
  $('preview').hidden = true
  if (!next) return
  try {
    const j = await post('preview', next)
    preview = j.preview
    renderPreview(preview)
  } catch (e) {
    show($('src-err'), e.message)
  }
}

let linkTimer = 0
$('link').addEventListener('input', () => {
  clearTimeout(linkTimer)
  const v = $('link').value.trim()
  if (v) $('plan').value = ''
  linkTimer = setTimeout(() => readSource(v ? { link: v } : null), 350)
})
$('plan').addEventListener('change', async () => {
  const f = $('plan').files[0]
  if (!f) return readSource(null)
  $('link').value = ''
  if (f.size > 256 * 1024) return show($('src-err'), 'That file is bigger than any plan file. Is it the right one?')
  let plan
  try { plan = JSON.parse(await f.text()) } catch { return show($('src-err'), 'That file is not an openGym plan file (it is not JSON).') }
  readSource({ plan })
})

/* ------------------------------- the cover photo ------------------------------- */

const toBase64 = blob => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result).split(',')[1])
  r.onerror = rej
  r.readAsDataURL(blob)
})

// Drawn onto a canvas: that applies the phone's rotation and leaves the location and camera data
// behind. The service re-encodes it again either way.
async function shrink(file) {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.86))
  if (blob && blob.type === 'image/webp') return blob
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.86))
}

$('cover').addEventListener('change', async () => {
  const f = $('cover').files[0]
  const img = $('coverprev')
  cover = null
  img.hidden = true
  show($('send-err'), '')
  if (!f) return
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { $('cover').value = ''; return show($('send-err'), 'The photo has to be a JPG, PNG or WebP.') }
  if (f.size > MAX_PHOTO) { $('cover').value = ''; return show($('send-err'), 'That photo is over 8 MB. A smaller one, please.') }
  try {
    const blob = typeof createImageBitmap === 'function' ? await shrink(f) : f
    cover = { type: blob.type, data: await toBase64(blob) }
    img.src = URL.createObjectURL(blob)
    img.alt = 'Your cover photo'
    img.hidden = false
  } catch {
    $('cover').value = ''
    show($('send-err'), 'This browser could not read that photo. Try another one.')
  }
})

/* ------------------------------- sending ------------------------------- */

function fieldError(name, msg) {
  const el = form.elements[name]
  if (!el) return
  el.setAttribute('aria-invalid', 'true')
  el.addEventListener('input', () => el.removeAttribute('aria-invalid'), { once: true })
  if (msg) el.focus()
}

form.addEventListener('submit', async e => {
  e.preventDefault()
  show($('send-err'), '')
  form.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'))
  if (!source || !preview) {
    show($('src-err'), 'Start with the routine: paste its link or pick its plan file.')
    $('link').focus()
    return
  }
  for (const name of ['title', 'description', 'author', 'duration']) {
    const el = form.elements[name]
    if (!el.checkValidity()) {
      fieldError(name, true)
      show($('send-err'), `Check "${el.closest('label').querySelector('span').textContent}": ${el.validationMessage}`)
      return
    }
  }
  if (form.authorUrl.value && !/^https:\/\/\S+\.\S+/.test(form.authorUrl.value.trim())) { fieldError('authorUrl', true); return show($('send-err'), 'The link has to start with https://') }
  if (cover && !form.coverAlt.value.trim()) { fieldError('coverAlt', true); return show($('send-err'), 'Say in a sentence what the photo shows.') }
  if (!form.consent.checked) { form.consent.focus(); return show($('send-err'), 'Tick the box to say it is yours to share.') }
  const btn = $('send')
  btn.setAttribute('aria-busy', 'true')
  btn.textContent = 'Sending…'
  try {
    await post('submit', {
      ...source,
      title: form.title.value, description: form.description.value, about: form.about.value,
      goal: form.goal.value, level: form.level.value, split: form.split.value,
      duration: Number(form.duration.value), language: form.language.value,
      tags: form.tags.value.split(',').map(t => t.trim()).filter(Boolean),
      author: form.author.value, authorUrl: form.authorUrl.value.trim(),
      cover, coverAlt: form.coverAlt.value,
      consent: true, website: form.website.value, ms: Date.now() - started
    })
    form.hidden = true
    $('done').hidden = false
    $('done').focus()
  } catch (err) {
    show($('send-err'), err.problems?.length ? `${err.message} ${err.problems.slice(0, 4).join(' · ')}` : err.message)
  } finally {
    btn.removeAttribute('aria-busy')
    btn.textContent = 'Send for review'
  }
})
