const MAX_LENGTH = 1024
const MAX_NODES = 128
const MAX_DEPTH = 16
const MAX_VARIABLES = 16
const MAX_STEPS = 512

function gcd(left, right) {
  left = left < 0n ? -left : left
  right = right < 0n ? -right : right
  while (right) [left, right] = [right, left % right]
  return left || 1n
}

function rational(numerator, denominator = 1n) {
  if (denominator === 0n) throw new Error('Division by zero is not allowed.')
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator }
  const divisor = gcd(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

function decimal(text) {
  const [whole, fraction = ''] = text.split('.')
  return rational(BigInt(whole || '0') * (10n ** BigInt(fraction.length)) + BigInt(fraction || '0'), 10n ** BigInt(fraction.length))
}

function tokens(expression) {
  expression = expression.trim()
  if (!expression || expression.length > MAX_LENGTH) throw new Error(`Formula must contain 1-${MAX_LENGTH} characters.`)
  const result = []
  for (let index = 0; index < expression.length;) {
    const character = expression[index]
    if (/\s/.test(character)) { index += 1; continue }
    if (/[\d.]/.test(character)) {
      const start = index
      while (index < expression.length && /[\d.]/.test(expression[index])) index += 1
      const value = expression.slice(start, index)
      if (value === '.' || (value.match(/\./g) || []).length > 1) throw new Error(`Invalid decimal at position ${start + 1}.`)
      if ((value.split('.')[1] || '').length > 6) throw new Error(`Money constants support at most six decimal places at position ${start + 1}.`)
      result.push({ kind: 'number', text: value, position: start }); continue
    }
    if (/[A-Za-z_]/.test(character)) {
      const start = index
      while (index < expression.length && /[A-Za-z0-9_]/.test(expression[index])) index += 1
      const value = expression.slice(start, index)
      result.push({ kind: ['and', 'or', 'not'].includes(value) ? value : 'identifier', text: value, position: start }); continue
    }
    const pair = expression.slice(index, index + 2)
    if (['<=', '>=', '==', '!='].includes(pair)) { result.push({ kind: pair, text: pair, position: index }); index += 2; continue }
    if ('+-*/(),<>'.includes(character)) { result.push({ kind: character, text: character, position: index }); index += 1; continue }
    throw new Error(`Unsupported formula character "${character}" at position ${index + 1}.`)
  }
  result.push({ kind: 'eof', text: '', position: expression.length })
  return result
}

class Parser {
  constructor(expression) { this.tokens = tokens(expression); this.index = 0; this.nodes = 0 }
  current() { return this.tokens[this.index] }
  consume(kind) { if (this.current().kind !== kind) return false; this.index += 1; return true }
  node(kind, value, args = []) { this.nodes += 1; if (this.nodes > MAX_NODES) throw new Error(`Formula exceeds ${MAX_NODES} AST nodes.`); return { kind, value, args } }
  depth(depth) { if (depth > MAX_DEPTH) throw new Error(`Formula exceeds ${MAX_DEPTH} levels of nesting.`) }
  parse() { const root = this.parseOr(1); if (this.current().kind !== 'eof') throw new Error(`Unexpected token "${this.current().text}" at position ${this.current().position + 1}.`); return root }
  parseOr(depth) { this.depth(depth); let left = this.parseAnd(depth); while (this.consume('or')) left = this.node('binary', 'or', [left, this.parseAnd(depth)]); return left }
  parseAnd(depth) { let left = this.parseCompare(depth); while (this.consume('and')) left = this.node('binary', 'and', [left, this.parseCompare(depth)]); return left }
  parseCompare(depth) { let left = this.parseAdd(depth); while (['<', '<=', '>', '>=', '==', '!='].includes(this.current().kind)) { const operator = this.current().kind; this.index += 1; left = this.node('binary', operator, [left, this.parseAdd(depth)]) } return left }
  parseAdd(depth) { let left = this.parseMultiply(depth); while (['+', '-'].includes(this.current().kind)) { const operator = this.current().kind; this.index += 1; const right = this.parseMultiply(depth); left = this.node('binary', operator, [left, right]) } return left }
  parseMultiply(depth) { let left = this.parseUnary(depth); while (['*', '/'].includes(this.current().kind)) { const operator = this.current().kind; this.index += 1; const right = this.parseUnary(depth); left = this.node('binary', operator, [left, right]) } return left }
  parseUnary(depth) { if (this.consume('not')) return this.node('unary', 'not', [this.parseUnary(depth)]); return this.parsePrimary(depth) }
  parsePrimary(depth) {
    this.depth(depth)
    const token = this.current()
    if (token.kind === 'number') { this.index += 1; return this.node('number', token.text) }
    if (token.kind === 'identifier') {
      this.index += 1
      if (!this.consume('(')) return this.node('variable', token.text)
      const args = []
      if (!this.consume(')')) { for (;;) { args.push(this.parseOr(depth + 1)); if (this.consume(')')) break; if (!this.consume(',')) throw new Error("Expected ',' or ')' in function call.") } }
      const functions = { min: 2, max: 2, ceil: 1, floor: 1, if: 3 }
      if (!(token.text in functions)) throw new Error(`Function ${token.text} is not allowed.`)
      if (args.length !== functions[token.text]) throw new Error(`Function ${token.text} requires ${functions[token.text]} arguments.`)
      return this.node('call', token.text, args)
    }
    if (this.consume('(')) { const value = this.parseOr(depth + 1); if (!this.consume(')')) throw new Error("Expected ')'."); return value }
    throw new Error(`Unexpected token "${token.text}" at position ${token.position + 1}.`)
  }
}

function collectVariables(node, found) { if (node.kind === 'variable') found.add(node.value); node.args.forEach((child) => collectVariables(child, found)) }
function canonicalNode(node) {
  if (node.kind === 'number') {
    const value = decimal(node.value)
    return `n:${value.denominator === 1n ? value.numerator : `${value.numerator}/${value.denominator}`}`
  }
  if (node.kind === 'variable') return `v:${node.value}`
  return `(${node.kind}:${node.value} ${node.args.map(canonicalNode).join(' ')})`
}
function displayNode(node) {
  if (node.kind === 'number' || node.kind === 'variable') return node.value
  if (node.kind === 'unary') return `not (${displayNode(node.args[0])})`
  if (node.kind === 'binary') return `(${displayNode(node.args[0])} ${node.value} ${displayNode(node.args[1])})`
  return `${node.value}(${node.args.map(displayNode).join(', ')})`
}
function numeric(value) { if (!value || value.kind !== 'number') throw new Error('Formula expected a number.'); return value.value }
function boolean(value) { if (!value || value.kind !== 'boolean') throw new Error('Formula expected a condition.'); return value.value }
function numberResult(value) { return { kind: 'number', value } }
function booleanResult(value) { return { kind: 'boolean', value } }
function add(a, b) { return rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator) }
function subtract(a, b) { return rational(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator) }
function multiply(a, b) { return rational(a.numerator * b.numerator, a.denominator * b.denominator) }
function divide(a, b) { return rational(a.numerator * b.denominator, a.denominator * b.numerator) }
function compare(a, b) { const difference = a.numerator * b.denominator - b.numerator * a.denominator; return difference < 0n ? -1 : difference > 0n ? 1 : 0 }
function integerRound(value, mode) { let quotient = value.numerator / value.denominator; const remainder = value.numerator % value.denominator; if (mode === 'ceil' && remainder > 0n) quotient += 1n; if (mode === 'floor' && remainder < 0n) quotient -= 1n; return rational(quotient) }

function evaluateNode(node, variables, state) {
  state.steps += 1
  if (state.steps > MAX_STEPS) throw new Error('Formula evaluation step limit exceeded.')
  if (node.kind === 'number') return numberResult(decimal(node.value))
  if (node.kind === 'variable') { const value = variables[node.value]; if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Formula variable ${node.value} requires a non-negative safe integer.`); return numberResult(rational(BigInt(value))) }
  if (node.kind === 'unary') return booleanResult(!boolean(evaluateNode(node.args[0], variables, state)))
  if (node.kind === 'binary') {
    const left = evaluateNode(node.args[0], variables, state)
    if (node.value === 'and') { const value = boolean(left); return value ? booleanResult(boolean(evaluateNode(node.args[1], variables, state))) : booleanResult(false) }
    if (node.value === 'or') { const value = boolean(left); return value ? booleanResult(true) : booleanResult(boolean(evaluateNode(node.args[1], variables, state))) }
    const right = evaluateNode(node.args[1], variables, state), a = numeric(left), b = numeric(right)
    if (node.value === '+') return numberResult(add(a, b)); if (node.value === '-') return numberResult(subtract(a, b)); if (node.value === '*') return numberResult(multiply(a, b)); if (node.value === '/') return numberResult(divide(a, b))
    const result = compare(a, b); return booleanResult(node.value === '<' ? result < 0 : node.value === '<=' ? result <= 0 : node.value === '>' ? result > 0 : node.value === '>=' ? result >= 0 : node.value === '==' ? result === 0 : result !== 0)
  }
  if (node.kind === 'call') {
    if (node.value === 'if') return evaluateNode(boolean(evaluateNode(node.args[0], variables, state)) ? node.args[1] : node.args[2], variables, state)
    const values = node.args.map((child) => numeric(evaluateNode(child, variables, state)))
    if (node.value === 'min') return numberResult(compare(values[0], values[1]) <= 0 ? values[0] : values[1])
    if (node.value === 'max') return numberResult(compare(values[0], values[1]) >= 0 ? values[0] : values[1])
    return numberResult(integerRound(values[0], node.value))
  }
  throw new Error('Invalid formula AST.')
}

export function compilePriceFormula(expression, allowedVariables) {
  const root = new Parser(expression).parse()
  const referenced = new Set(); collectVariables(root, referenced)
  if (referenced.size > MAX_VARIABLES) throw new Error(`Formula references more than ${MAX_VARIABLES} variables.`)
  const allowed = new Set(allowedVariables)
  for (const variable of referenced) if (!allowed.has(variable)) throw new Error(`Formula variable ${variable} is not verified for this Operation.`)
  const variables = [...referenced].sort()
  return {
    canonical: canonicalNode(root),
    formatted: displayNode(root),
    variables,
    evaluate(usage, maximumAtomic) {
      if (!Number.isSafeInteger(maximumAtomic) || maximumAtomic < 1) throw new Error('Maximum charge must be a positive USDC value.')
      const result = numeric(evaluateNode(root, usage, { steps: 0 }))
      if (result.numerator < 0n) throw new Error('Formula result cannot be negative.')
      const atomic = multiply(result, rational(1000000n))
      let unbounded = atomic.numerator / atomic.denominator
      if (atomic.numerator % atomic.denominator > 0n) unbounded += 1n
      if (unbounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Formula result exceeds supported money range.')
      const unboundedAtomic = Number(unbounded)
      return { unboundedAtomic, billedAtomic: Math.min(unboundedAtomic, maximumAtomic) }
    },
  }
}
