import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRenderServer } from './server.mjs'

let server
let baseURL

before(async () => {
  server = createRenderServer({ publicBaseUrl: 'http://127.0.0.1:8791' })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  baseURL = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

test('health endpoint reports the puppy-card service ready', async () => {
  const response = await fetch(`${baseURL}/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: 'ok',
    service: 'exora-random-puppy-card-api',
    version: '2.0.0',
  })
})

test('health endpoint supports Dock HEAD probes', async () => {
  const response = await fetch(`${baseURL}/health`, { method: 'HEAD' })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '')
})

test('puppy-card endpoint needs no input and returns every profile field', async () => {
  const response = await fetch(`${baseURL}/v1/puppy-card`, { method: 'POST' })
  const result = await response.json()

  assert.equal(response.status, 200)
  assert.equal(result.status, 'completed')
  assert.match(result.render_id, /^render_[a-f0-9]{24}$/)
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.equal(result.mime_type, 'image/svg+xml')
  assert.equal(result.width, 1200)
  assert.equal(result.height, 630)
  assert.deepEqual(Object.keys(result.dog).sort(), [
    'age',
    'breed',
    'favorite_activity',
    'favorite_food',
    'favorite_player',
    'home_address',
    'name',
  ])
  assert.ok(Number.isInteger(result.dog.age) && result.dog.age >= 1 && result.dog.age <= 12)
  for (const field of ['name', 'breed', 'favorite_food', 'favorite_activity', 'favorite_player', 'home_address']) {
    assert.equal(typeof result.dog[field], 'string')
    assert.ok(result.dog[field].length > 0)
  }

  const image = await fetch(result.image_url.replace('http://127.0.0.1:8791', baseURL))
  assert.equal(image.status, 200)
  assert.match(image.headers.get('content-type'), /^image\/svg\+xml/)
  const svg = await image.text()
  for (const value of Object.values(result.dog)) {
    assert.match(svg, new RegExp(String(value)))
  }
  assert.doesNotMatch(JSON.stringify(result), /[\u3400-\u9FFF]/)
  assert.doesNotMatch(svg, /[\u3400-\u9FFF]/)
  for (const label of ['AGE', 'BREED', 'FAVORITE FOOD', 'FAVORITE ACTIVITY', 'FAVORITE PLAYER', 'HOME ADDRESS']) {
    assert.match(svg, new RegExp(label))
  }
})

test('an Exora invocation ID makes retries stable while new calls receive a fresh card', async () => {
  const invoke = async (invocationId) => {
    const response = await fetch(`${baseURL}/v1/puppy-card`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Exora-Invocation-Id': invocationId,
      },
      body: '{}',
    })
    assert.equal(response.status, 200)
    return response.json()
  }

  const first = await invoke('inv-puppy-stable-a')
  const retry = await invoke('inv-puppy-stable-a')
  const next = await invoke('inv-puppy-stable-b')

  assert.deepEqual(retry, first)
  assert.notEqual(next.render_id, first.render_id)
})

test('old render route is no longer exposed', async () => {
  const response = await fetch(`${baseURL}/v1/render`, { method: 'POST', body: '{}' })
  assert.equal(response.status, 404)
})
