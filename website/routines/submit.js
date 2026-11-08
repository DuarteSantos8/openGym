// The submit form: reads an openGym routine link or plan file, asks the routines service what it
// makes of it (the same checks CI runs), shrinks the cover photo in the browser, and sends it all
// for review. Four steps, one on screen at a time; each field says what's wrong as you leave it,
// and the last step shows the routine roughly as the library will. Nothing is published until a
// person has looked at it.
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

/* ------------------------------- steps ------------------------------- */

const steps = [...form.querySelectorAll('.rt-step')]
const marks = [...document.querySelectorAll('#steps li')]
let step = 0
function go(i, { focus = true } = {}) {
  step = i
  steps.forEach((s, k) => s.classList.toggle('on', k === i))
  marks.forEach((m, k) => {
    m.classList.toggle('done', k < i)
    if (k === i) m.setAttribute('aria-current', 'step')
    else m.removeAttribute('aria-current')
  })
  if (i === 3) renderFinal()
  if (focus) {
    const h = steps[i].querySelector('h2')
    h.tabIndex = -1
    h.focus({ preventScroll: true })
    $('steps').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
}
form.addEventListener('click', e => {
  if (e.target.closest('[data-back]')) { go(Math.max(0, step - 1)); return }
  if (e.target.closest('[data-next]') && checkStep(step)) go(step + 1)
})
// Enter in a one-line field moves on instead of sending the whole form from step one.
form.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('input:not([type=checkbox]):not([type=file])') && step < 3) {
    e.preventDefault()
    if (checkStep(step)) go(step + 1)
  }
})

/* ------------------------------- fields ------------------------------- */

const LABEL = name => form.querySelector(`label[for="f-${name}"]`)?.textContent || name
function messageFor(el) {
  const v = el.value.trim()
  const name = el.name
  if (el.required && !v) return name === 'duration' ? 'How long is a session, roughly?' : `${LABEL(name)} is missing.`
  if (el.minLength > 0 && v && v.length < el.minLength) return `A bit more, please: at least ${el.minLength} characters (now ${v.length}).`
  if (name === 'duration') {
    const n = Number(v)
    if (!Number.isInteger(n) || n < Number(el.min) || n > Number(el.max)) return `Somewhere between ${el.min} and ${el.max} minutes.`
  }
  if ((name === 'description' || name === 'about' || name === 'title') && /https?:\/\/|www\./i.test(v)) return 'No links in here, please. There is a field for yours further on.'
  if (name === 'authorUrl' && v && !/^https:\/\/\S+\.\S+/.test(v)) return 'The link has to start with https://'
  if (name === 'tags' && v && v.split(',').filter(t => t.trim()).length > Number(el.dataset.max || 5)) return `Up to ${el.dataset.max || 5} tags.`
  if (name === 'coverAlt' && cover && !v) return 'Say in a sentence what the photo shows.'
  return ''
}
function setError(el, msg) {
  const err = $('e-' + el.name)
  if (msg) el.setAttribute('aria-invalid', 'true')
  else el.removeAttribute('aria-invalid')
  if (err) show(err, msg)
}
function checkField(el) { const m = messageFor(el); setError(el, m); return !m }
form.querySelectorAll('.rt-field input, .rt-field textarea').forEach(el => {
  if (!el.name || el.type === 'file' || el.id === 'link') return
  // Judge a field when the visitor leaves it, then keep the verdict fresh while they fix it.
  el.addEventListener('blur', () => { if (el.value || el.required) checkField(el) })
  el.addEventListener('input', () => { if (el.getAttribute('aria-invalid')) checkField(el) })
})
const tagsEl = form.elements.tags
if (tagsEl) tagsEl.dataset.max = (/Up to (\d+)/.exec($('h-tags')?.textContent || '') || [])[1] || '5'
const counter = form.querySelector('[data-count="description"]')
form.elements.description.addEventListener('input', () => {
  const el = form.elements.description
  counter.textContent = el.value.length ? `(${el.value.length}/${el.maxLength})` : ''
})

function checkStep(i) {
  if (i === 0) {
    if (!source || !preview) {
      show($('src-err'), source ? 'Fix the routine first: see the message above.' : 'Start with the routine: paste its link or pick its plan file.')
      $('link').focus()
      return false
    }
    return true
  }
  const els = [...steps[i].querySelectorAll('.rt-field input:not([type=file]), .rt-field textarea')]
  let first = null
  for (const el of els) if (!checkField(el) && !first) first = el
  if (first) first.focus()
  return !first
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
  $('reading').hidden = false
  try {
    const j = await post('preview', next)
    preview = j.preview
    renderPreview(preview)
  } catch (e) {
    show($('src-err'), e.problems?.length ? `${e.message} ${e.problems.slice(0, 4).join(' ')}` : e.message)
  } finally {
    $('reading').hidden = true
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

const coverEl = form.elements.cover
coverEl.addEventListener('change', async () => {
  const f = coverEl.files[0]
  const img = $('coverprev')
  cover = null
  img.hidden = true
  show($('e-cover'), '')
  if (!f) return
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { coverEl.value = ''; return show($('e-cover'), 'The photo has to be a JPG, PNG or WebP.') }
  if (f.size > MAX_PHOTO) { coverEl.value = ''; return show($('e-cover'), 'That photo is over 8 MB. A smaller one, please.') }
  try {
    const blob = typeof createImageBitmap === 'function' ? await shrink(f) : f
    cover = { type: blob.type, data: await toBase64(blob) }
    img.src = URL.createObjectURL(blob)
    img.alt = 'Your cover photo'
    img.hidden = false
  } catch {
    coverEl.value = ''
    show($('e-cover'), 'This browser could not read that photo. Try another one.')
  }
})

/* ------------------------------- the last look ------------------------------- */

const text = (tag, cls, value) => { const el = document.createElement(tag); if (cls) el.className = cls; el.textContent = value; return el }
const optLabel = name => form.elements[name].selectedOptions[0]?.textContent || ''
function renderFinal() {
  const box = $('final')
  const card = document.createElement('div')
  card.className = 'rc-link'
  const head = text('span', 'rc-head', '')
  head.append(text('span', 'rc-title', form.title.value.trim() || 'Untitled'), text('span', 'rc-by', `by ${form.author.value.trim() || 'you'}`))
  const tags = text('span', 'rc-tags', '')
  const goal = text('span', 'tag goal', optLabel('goal'))
  tags.append(goal, text('span', 'tag', optLabel('level')), text('span', 'tag', optLabel('split')))
  const stats = text('span', 'rc-stats', '')
  const n = preview?.schedule?.length || preview?.sessions?.length || 0
  for (const [b, rest] of [[n, n === 1 ? ' day' : ' days'], [form.duration.value, ' min'], [preview?.exerciseCount || 0, ' exercises']]) {
    const s = document.createElement('span')
    s.append(text('b', '', String(b)), document.createTextNode(rest))
    stats.appendChild(s)
  }
  const list = text('div', 'fin-days', '')
  for (const s of preview?.sessions || []) {
    const d = document.createElement('div')
    d.append(text('b', '', s.name), document.createTextNode(`: ${s.exercises.map(x => x.name).join(', ')}`))
    list.appendChild(d)
  }
  card.append(head, tags, text('span', 'rc-desc', form.description.value.trim()), stats, list)
  if (cover) {
    const img = document.createElement('img')
    img.className = 'rc-cover'
    img.src = $('coverprev').src
    img.alt = form.coverAlt.value
    card.prepend(img)
  }
  box.replaceChildren(card)
}

/* ------------------------------- sending ------------------------------- */

form.addEventListener('submit', async e => {
  e.preventDefault()
  show($('send-err'), '')
  for (let i = 0; i < 3; i++) {
    if (!checkStep(i)) { go(i, { focus: false }); return }
  }
  if (!form.consent.checked) {
    show($('e-consent'), 'Tick the box to say it is yours to share.')
    form.consent.focus()
    return
  }
  show($('e-consent'), '')
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
    $('steps').hidden = true
    $('done').hidden = false
    $('done').focus()
  } catch (err) {
    show($('send-err'), err.problems?.length ? `${err.message} ${err.problems.slice(0, 4).join(' ')}` : err.message)
  } finally {
    btn.removeAttribute('aria-busy')
    btn.textContent = 'Send for review'
  }
})
form.consent.addEventListener('change', () => { if (form.consent.checked) show($('e-consent'), '') })

go(0, { focus: false })
