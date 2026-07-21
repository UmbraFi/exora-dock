import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createTarotServer } from './server.mjs'

let server
let baseURL

before(async () => {
  server = createTarotServer({ publicBaseUrl: 'http://127.0.0.1:8792' })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  baseURL = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

test('health endpoint is ready and supports HEAD probes', async () => {
  const response = await fetch(`${baseURL}/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: 'ok',
    service: 'exora-random-tarot-api',
    version: '1.0.0',
  })
  const head = await fetch(`${baseURL}/health`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
})

test('zero-input endpoint draws three unique cards and renders an SVG', async () => {
  const response = await fetch(`${baseURL}/v1/draw-three`, { method: 'POST' })
  const result = await response.json()

  assert.equal(response.status, 200)
  assert.equal(result.status, 'completed')
  assert.match(result.draw_id, /^draw_[a-f0-9]{24}$/)
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.equal(result.mime_type, 'image/svg+xml')
  assert.equal(result.width, 1440)
  assert.equal(result.height, 760)
  assert.equal(result.cards.length, 3)
  assert.deepEqual(result.cards.map((card) => card.position), ['PAST', 'PRESENT', 'FUTURE'])
  assert.equal(new Set(result.cards.map((card) => card.name)).size, 3)
  for (const card of result.cards) {
    assert.ok(['UPRIGHT', 'REVERSED'].includes(card.orientation))
    for (const field of ['name', 'arcana', 'suit', 'meaning']) assert.ok(card[field].length > 0)
  }

  const image = await fetch(result.image_url.replace('http://127.0.0.1:8792', baseURL))
  assert.equal(image.status, 200)
  assert.match(image.headers.get('content-type'), /^image\/svg\+xml/)
  const svg = await image.text()
  for (const card of result.cards) assert.match(svg, new RegExp(card.name))
  assert.doesNotMatch(svg, /[\u3400-\u9FFF]/)
})

test('zero-input endpoint rejects supplied fields with a structured error', async () => {
  const response = await fetch(`${baseURL}/v1/draw-three`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'What happens next?' }),
  })

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    code: 'invalid_input',
    message: 'This zero-input operation accepts only an empty JSON object.',
  })
})

test('the same Exora invocation is stable and a new invocation creates a new draw', async () => {
  const invoke = async (id) => {
    const response = await fetch(`${baseURL}/v1/draw-three`, {
      method: 'POST',
      headers: { 'X-Exora-Invocation-Id': id },
    })
    assert.equal(response.status, 200)
    return response.json()
  }

  const first = await invoke('inv-tarot-a')
  const retry = await invoke('inv-tarot-a')
  const next = await invoke('inv-tarot-b')
  assert.deepEqual(retry, first)
  assert.notEqual(next.draw_id, first.draw_id)
})
