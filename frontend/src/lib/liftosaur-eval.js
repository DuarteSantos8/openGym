// Isolated, deterministic evaluator for a small Liftoscript-style
// progression subset. It never uses eval/Function and never touches
// openGym's progression engine: the output is a proposed next state that
// callers may compare against the existing engine before adopting anything.
// Supported: `weight`/`reps` assignment and +=/-=, if/else blocks,
// + - * / %, comparisons, roundWeight(x, step), numeric literals with an
// optional kg/lb suffix (reported via unitNote, values stay in the active
// unit), and // comments. Anything else is rejected, never guessed.
const MAX_LEN = 2000
const VARS = new Set(['weight', 'reps', 'completedReps', 'rpe'])

const tokenize = source => {
  const tokens = []
  let i = 0
  let unitNote = null
  while (i < source.length) {
    const ch = source[i]
    if (/\s/.test(ch)) { i++; continue }
    if (source.startsWith('//', i)) { while (i < source.length && source[i] !== '\n') i++; continue }
    const num = /^(\d+(?:\.\d+)?)(kg|lb)?/.exec(source.slice(i))
    if (num) {
      if (num[2]) {
        if (unitNote && unitNote !== num[2]) throw new Error('Mixed units in one script')
        unitNote = num[2]
      }
      tokens.push({ t: 'num', v: Number(num[1]) }); i += num[0].length; continue
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))
    if (ident) { tokens.push({ t: 'id', v: ident[0] }); i += ident[0].length; continue }
    const two = source.slice(i, i + 2)
    if (['+=', '-=', '>=', '<=', '==', '!='].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue }
    if ('+-*/%(){}=<>'.includes(ch)) { tokens.push({ t: 'op', v: ch }); i++; continue }
    if (ch === ',') { tokens.push({ t: 'comma' }); i++; continue }
    throw new Error(`Unknown character in script: ${ch}`)
  }
  return { tokens, unitNote }
}

export function evaluateLiftoscript(script, context = {}) {
  const source = String(script ?? '')
  if (source.length > MAX_LEN) throw new Error('Script is too long')
  const { tokens, unitNote } = tokenize(source)
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new Error('Invalid context')
  const validate = (name, value, label) => {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} ${name} must be finite and nonnegative`)
    if ((name === 'reps' || name === 'completedReps') && !Number.isSafeInteger(value)) throw new Error(`${label} ${name} must be a safe integer`)
    return value
  }
  const state = Object.fromEntries([...VARS].map(name => [name, validate(name, context[name] === undefined ? 0 : context[name], 'Context')]))
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  const expectOp = v => {
    const tok = next()
    if (!tok || tok.v !== v) throw new Error(`Expected ${v} in script`)
  }

  const parsePrimary = () => {
    const tok = next()
    if (!tok) throw new Error('Unexpected end of script')
    if (tok.t === 'num') return tok.v
    if (tok.v === '(') { const v = parseExpr(); expectOp(')'); return v }
    if (tok.t === 'id') {
      if (tok.v === 'roundWeight') {
        expectOp('(')
        const value = parseExpr()
        let step = 0
        if (peek()?.t === 'comma') { next(); step = parseExpr() }
        expectOp(')')
        return step > 0 ? Math.round(value / step) * step : value
      }
      if (VARS.has(tok.v)) return state[tok.v]
      throw new Error(`Unknown identifier: ${tok.v}`)
    }
    if (tok.v === '-') return -parsePrimary()
    throw new Error(`Unknown token in script: ${tok.v}`)
  }
  const parseTerm = () => {
    let v = parsePrimary()
    while (peek() && ['*', '/', '%'].includes(peek().v)) {
      const op = next().v
      const rhs = parsePrimary()
      v = op === '*' ? v * rhs : op === '/' ? v / rhs : v % rhs
    }
    return v
  }
  const parseExpr = () => {
    let v = parseTerm()
    while (peek() && ['+', '-'].includes(peek().v)) {
      const op = next().v
      const rhs = parseTerm()
      v = op === '+' ? v + rhs : v - rhs
    }
    return v
  }
  const parseCondition = () => {
    const left = parseExpr()
    if (!Number.isFinite(left)) throw new Error('Condition must be finite')
    const tok = peek()
    if (tok && ['>=', '<=', '==', '!=', '>', '<'].includes(tok.v)) {
      next()
      const right = parseExpr()
      if (!Number.isFinite(right)) throw new Error('Condition must be finite')
      return tok.v === '>=' ? left >= right : tok.v === '<=' ? left <= right
        : tok.v === '==' ? left === right : tok.v === '!=' ? left !== right
        : tok.v === '>' ? left > right : left < right
    }
    return left !== 0
  }
  const parseBlock = () => {
    expectOp('{')
    const start = pos
    let depth = 1
    while (pos < tokens.length && depth > 0) {
      if (tokens[pos].v === '{') depth++
      else if (tokens[pos].v === '}') depth--
      pos++
    }
    if (depth !== 0) throw new Error('Unbalanced brace block in script')
    return tokens.slice(start, pos - 1)
  }
  const runTokens = list => {
    const saved = tokens.splice(0, tokens.length, ...list)
    const savedPos = pos
    pos = 0
    try { parseStatements(true) } finally {
      tokens.splice(0, tokens.length, ...saved)
      pos = savedPos
    }
  }
  const parseStatements = (inBlock = false) => {
    while (pos < tokens.length) {
      const tok = peek()
      if (tok.v === '}') {
        if (!inBlock) throw new Error('Unbalanced brace block in script')
        return
      }
      if (tok.t === 'id' && tok.v === 'if') {
        next(); expectOp('(')
        const cond = parseCondition()
        expectOp(')')
        const thenBlock = parseBlock()
        let elseBlock = null
        if (peek()?.v === 'else') { next(); elseBlock = parseBlock() }
        if (cond) runTokens(thenBlock)
        else if (elseBlock) runTokens(elseBlock)
        continue
      }
      if (tok.t === 'id' && VARS.has(tok.v) && tok.v !== 'completedReps' && tok.v !== 'rpe') {
        const name = next().v
        const op = next()
        if (!op || !['=', '+=', '-='].includes(op.v)) throw new Error(`Expected assignment after ${name}`)
        if (name === 'reps' || name === 'weight') {
          const value = parseExpr()
          state[name] = validate(name, op.v === '=' ? value : op.v === '+=' ? state[name] + value : state[name] - value, 'Target')
          continue
        }
      }
      if (tok.t === 'id') throw new Error(`Unknown identifier: ${tok.v}`)
      throw new Error(`Unknown statement in script near: ${tok.v}`)
    }
    // Block token slices carry no closing brace; reaching the end is normal.
  }

  parseStatements(false)
  return { weight: +state.weight.toFixed(4), reps: state.reps, unitNote }
}
