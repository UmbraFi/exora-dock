const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

test('desktop formula preview matches the shared conformance fixtures', async () => {
  const { compilePriceFormula } = await import('../src/pricing-formula.js')
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../contracts/exora.price-formula.v4.conformance.json'), 'utf8'))
  for (const entry of fixture.cases) {
    const compiled = compilePriceFormula(entry.expression, entry.allowedVariables)
    const astSha256 = crypto.createHash('sha256').update(`${fixture.language}\n${compiled.canonical}`).digest('hex')
    assert.equal(astSha256, entry.astSha256, `${entry.name} AST hash`)
    assert.deepEqual(compiled.evaluate(entry.variables, entry.maximumChargePerInvocationAtomic), {
      unboundedAtomic: entry.unboundedAtomic,
      billedAtomic: entry.billedAtomic,
    }, entry.name)
  }
})

test('desktop formula preview rejects unsafe expressions', async () => {
  const { compilePriceFormula } = await import('../src/pricing-formula.js')
  for (const expression of ['process.exit(1)', 'random()', 'unknown * 0.1']) {
    assert.throws(() => compilePriceFormula(expression, ['input_tokens']), expression)
  }
  assert.throws(() => compilePriceFormula('input_tokens / output_tokens', ['input_tokens', 'output_tokens']).evaluate({ input_tokens: 10, output_tokens: 0 }, 100000))
})
