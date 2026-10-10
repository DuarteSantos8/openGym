import { describe, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import pt from '../locales/pt.js'
import ptBR, { PT_BR_OVERRIDES } from '../locales/pt-BR.js'
import { DATE_LOCALES, LANGS } from './i18n-core.js'

const placeholders = value => [...String(value).matchAll(/\{\d+\}/g)].map(match => match[0]).sort()
const byCodeUnit = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)

describe('Brazilian Portuguese locale', () => {
  test('is a separately selectable locale with Brazilian date formatting', () => {
    expect(LANGS.pt).toBe('Português (Portugal)')
    expect(LANGS['pt-BR']).toBe('Português (Brasil)')
    expect(DATE_LOCALES['pt-BR']).toBe('pt-BR')
  })

  test('matches the source key set and preserves interpolation placeholders', () => {
    expect(Object.keys(ptBR).sort()).toEqual(Object.keys(pt).sort())
    for (const [source, translated] of Object.entries(ptBR)) {
      expect(placeholders(translated), source).toEqual(placeholders(source))
    }
  })

  test('makes every inherited pt-PT value an explicit reviewed snapshot', () => {
    const inherited = Object.entries(pt)
      .filter(([key]) => !(key in PT_BR_OVERRIDES))
      .sort(byCodeUnit)
    const fingerprint = createHash('sha256').update(JSON.stringify(inherited)).digest('hex')

    // Every override names a real source string, so the two sets partition pt-PT's keys between
    // them and the fingerprint below covers everything not overridden. A typo'd override key
    // would otherwise sit in the file translating nothing.
    const stray = Object.keys(PT_BR_OVERRIDES).filter(key => !(key in pt))
    expect(stray, 'override keys that are not pt-PT keys').toEqual([])
    expect(Object.keys(PT_BR_OVERRIDES).length + inherited.length).toBe(Object.keys(pt).length)
    // …and each one really reaches the pack, whatever the spread order does.
    for (const [key, value] of Object.entries(PT_BR_OVERRIDES)) expect(ptBR[key], key).toBe(value)

    // The counts themselves are read off the pack rather than pinned here: a new UI string lands
    // in pt.js and pt-BR.js together and moves both, and a number in a test that every new string
    // has to be taught is a number nobody reads. What the numbers stood for is asserted above.
    // If the hash fails, review the changed keys and wording before accepting a new one. From
    // frontend/: node scripts/pt-br-inheritance-fingerprint.mjs --list
    expect(fingerprint, 'pt-PT inheritance changed; review the inherited pt-BR wording').toBe('bd0bc1e5a907f1a186d92cbb26a2168a9a00db70677beeecd80113fb414486b9')
  })

  // pt-PT labelled Unpair 'Desfazer': Undo, in Portuguese (it is pt-BR's Undo), on the button that
  // takes an exercise out of a superset. Neither pack may give Unpair a word either of them uses for Undo.
  test('does not label Unpair with an Undo word in either Portuguese pack', () => {
    for (const [name, pack] of [['pt', pt], ['pt-BR', ptBR]]) expect([pt.Undo, ptBR.Undo], name).not.toContain(pack.Unpair)
  })

  test('does not leak European Portuguese UI terms', () => {
    const text = Object.values(ptBR).join('\n')
    const europeanPortuguese = /(?:^|[^\p{L}])(?:ficheiro\p{L}*|telemóvel\p{L}*|ecrã\p{L}*|regist(?:o|am|ado|ada|ados|adas)|eliminad\p{L}*|definições|cronómetro|detetad\p{L}*|gémeos|abdómen|anca|coifa dos rotadores|escadora|completaste|acabaste|aguentas|definires|completares|aguenta|aguentaste|ficaste|viajares)(?=$|[^\p{L}])/iu
    expect(text).not.toMatch(europeanPortuguese)
    expect(text).not.toMatch(/[«»]/u)
    expect(ptBR.Save).toBe('Salvar')
    expect(ptBR.Settings).toBe('Configurações')
    expect(ptBR['Delete workout']).toBe('Excluir treino')
    expect(ptBR.Superset).toBe('Superset')
    expect(ptBR['Guest mode: your data lives only in this browser.']).toContain('visitante')
    expect(ptBR['Sign in with passkey']).toContain('chave de acesso')
    expect(ptBR.band).toBe('elástico')
    expect(ptBR['resistance band']).toBe('faixa elástica')
    expect(ptBR.soleus).toBe('sóleo')
    expect(ptBR.Unpair).toBe('Desvincular')
    expect(ptBR['Choose starter plan']).toBe('Escolha um plano inicial')
    // The sign-in e-mail's strings are overridden, not inherited: pt-PT says palavra-passe and «».
    expect(ptBR['Wrong name, e-mail or password.']).toBe('Nome, e-mail ou senha incorretos.')
    expect(ptBR['Sign-in e-mail']).toBe('E-mail de login')
    for (const key of ['Name or e-mail', 'Sign in with “{0}” instead of your name', '“{0}” is saved, but signs in only once this profile has a password.', 'Type it at “Sign in with password” instead of your profile name. We never send anything to it; a forgotten password is still reset by your admin.'])
      expect(key in PT_BR_OVERRIDES, key).toBe(true)
    // So are the backup import's warning (pt-PT says cópia and registado) and the sign-in hold's
    // status (pt-PT says «À espera da tua resposta»).
    for (const key of ['The server has 1 workout that is not in this backup, logged since it was made or on another device. Replacing deletes it.', 'The server has {0} workouts that are not in this backup, logged since it was made or on another device. Replacing deletes them.', 'Replace anyway', 'Merge them in', 'Waiting for your answer about this device’s workouts', 'Nothing syncs until you say whether this device’s workouts go into your profile. Tap to answer.'])
      expect(key in PT_BR_OVERRIDES, key).toBe(true)
  })
})
