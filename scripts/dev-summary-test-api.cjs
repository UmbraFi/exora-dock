const http = require('node:http')

const host = '127.0.0.1'
const port = Number.parseInt(process.env.EXORA_TEST_API_PORT || '3000', 10)
const maximumRequestBytes = 1024 * 1024

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('EXORA_TEST_API_PORT must be a valid TCP port')
}

function sendJSON(response, statusCode, value) {
  const body = JSON.stringify(value)
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function summarize(text) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 120) return normalized
  return `${normalized.slice(0, 117).trimEnd()}...`
}

function readJSON(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let receivedBytes = 0
    let tooLarge = false

    request.on('data', (chunk) => {
      receivedBytes += chunk.length
      if (receivedBytes > maximumRequestBytes) {
        tooLarge = true
        chunks.length = 0
        return
      }
      if (!tooLarge) chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) {
        reject(new Error('request_too_large'))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('invalid_json'))
      }
    })
    request.on('error', reject)
  })
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${host}:${port}`)

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJSON(response, 200, { status: 'ok', service: 'exora-text-summary-test-api' })
    return
  }

  if (request.method === 'POST' && url.pathname === '/summarize') {
    try {
      const input = await readJSON(request)
      const text = typeof input?.text === 'string' ? input.text.trim() : ''
      if (!text) {
        sendJSON(response, 400, { error: 'invalid_text', message: 'text must be a non-empty string' })
        return
      }
      sendJSON(response, 200, {
        summary: summarize(text),
        usage: { inputCharacters: text.length },
      })
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'request_too_large'
      if (!response.headersSent) sendJSON(response, tooLarge ? 413 : 400, { error: tooLarge ? 'request_too_large' : 'invalid_json' })
    }
    return
  }

  sendJSON(response, 404, { error: 'not_found' })
})

server.requestTimeout = 30_000
server.headersTimeout = 10_000

server.listen(port, host, () => {
  console.log(`Exora Summary test API listening on http://${host}:${port}`)
})

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
