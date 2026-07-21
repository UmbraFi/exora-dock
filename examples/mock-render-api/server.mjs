import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8791
const MAX_REQUEST_BYTES = 64 * 1024
const MAX_RENDERS = 200
const CARD_WIDTH = 1200
const CARD_HEIGHT = 630

const puppyOptions = {
  names: ['Buddy', 'Coco', 'Biscuit', 'Mochi', 'Sunny', 'Teddy', 'Milo', 'Luna'],
  breeds: ['Shiba Inu', 'Golden Retriever', 'Corgi', 'Samoyed', 'Border Collie', 'Labrador', 'Bichon Frise', 'Siberian Husky'],
  foods: ['Chicken Biscuits', 'Salmon Bites', 'Peanut Butter Bones', 'Beef Treats', 'Pumpkin Cakes', 'Cheese Crisps', 'Apple Slices', 'Lamb Stew'],
  activities: ['Chasing Tennis Balls', 'Rolling on the Grass', 'Playing Frisbee', 'Napping in the Sun', 'Running on the Beach', 'Playing Hide-and-Seek', 'Collecting Sticks', 'Going for Car Rides'],
  players: ['Nova', 'Mika', 'Kumo', 'Pixel', 'Luna', 'Player One', 'Mochi', 'Sunny'],
  addresses: ['18 Sunshine Lane, Rainbow City', '7 Bone Street, Paw Town', '12 Strawberry Lane, Cloud Bay', '26 Moonlight Road, Star City', '9 Sea Breeze Street, Bark Island', '33 Pinecone Road, Forest Town', '5 Frisbee Lane, Happy Valley', '21 Biscuit Street, Cream Town'],
  palettes: [
    ['#FFF7ED', '#FB7185', '#7C2D12'],
    ['#EFF6FF', '#60A5FA', '#1E3A8A'],
    ['#F0FDF4', '#4ADE80', '#14532D'],
    ['#FAF5FF', '#C084FC', '#581C87'],
    ['#FFFBEB', '#FBBF24', '#78350F'],
    ['#F0FDFA', '#2DD4BF', '#134E4A'],
  ],
}

const renders = new Map()

function send(response, status, contentType, body, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, X-Exora-Invocation-Id',
    ...extraHeaders,
  })
  response.end(body)
}

function sendJSON(response, status, body) {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(body))
}

function escapeXML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character])
}

async function consumeRequest(request) {
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) throw new Error('Request body exceeds 65536 bytes.')
  }
}

function choose(values, digest, offset) {
  return values[digest[offset] % values.length]
}

function createPuppy(seed) {
  const digest = createHash('sha256').update(seed).digest()
  return {
    name: choose(puppyOptions.names, digest, 0),
    age: 1 + (digest[1] % 12),
    breed: choose(puppyOptions.breeds, digest, 2),
    favorite_food: choose(puppyOptions.foods, digest, 3),
    favorite_activity: choose(puppyOptions.activities, digest, 4),
    favorite_player: choose(puppyOptions.players, digest, 5),
    home_address: choose(puppyOptions.addresses, digest, 6),
    palette: choose(puppyOptions.palettes, digest, 7),
  }
}

function renderSVG(puppy) {
  const [background, accent, ink] = puppy.palette
  const rows = [
    ['AGE', `${puppy.age} YEARS OLD`],
    ['BREED', puppy.breed],
    ['FAVORITE FOOD', puppy.favorite_food],
    ['FAVORITE ACTIVITY', puppy.favorite_activity],
    ['FAVORITE PLAYER', puppy.favorite_player],
    ['HOME ADDRESS', puppy.home_address],
  ]
  const details = rows.map(([label, value], index) => {
    const x = index % 2 === 0 ? 465 : 820
    const y = 218 + Math.floor(index / 2) * 118
    return `<text x="${x}" y="${y}" fill="${ink}" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="19" font-weight="700" opacity="0.62">${escapeXML(label)}</text>
  <text x="${x}" y="${y + 36}" fill="${ink}" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="25" font-weight="700">${escapeXML(value)}</text>`
  }).join('\n  ')

  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${escapeXML(puppy.name)}'s puppy card">
  <rect width="100%" height="100%" rx="36" fill="${background}"/>
  <circle cx="1095" cy="92" r="150" fill="${accent}" opacity="0.16"/>
  <circle cx="78" cy="585" r="135" fill="${accent}" opacity="0.12"/>
  <rect x="52" y="52" width="1096" height="526" rx="30" fill="#FFFFFF" opacity="0.68"/>
  <circle cx="250" cy="283" r="146" fill="${accent}" opacity="0.18"/>
  <path d="M161 216 Q132 119 213 169 M339 216 Q368 119 287 169" fill="${accent}" stroke="${ink}" stroke-width="12" stroke-linejoin="round"/>
  <circle cx="250" cy="270" r="108" fill="${accent}"/>
  <circle cx="213" cy="257" r="10" fill="${ink}"/><circle cx="287" cy="257" r="10" fill="${ink}"/>
  <ellipse cx="250" cy="292" rx="18" ry="13" fill="${ink}"/>
  <path d="M250 304 Q230 329 209 309 M250 304 Q270 329 291 309" fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="round"/>
  <text x="250" y="478" text-anchor="middle" fill="${ink}" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="46" font-weight="800">${escapeXML(puppy.name)}</text>
  <text x="250" y="515" text-anchor="middle" fill="${ink}" opacity="0.62" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="20" font-weight="700" letter-spacing="3">RANDOM PUPPY</text>
  <text x="465" y="126" fill="${ink}" font-family="system-ui, sans-serif" font-size="43" font-weight="850">MY PUPPY CARD</text>
  <rect x="465" y="150" width="116" height="8" rx="4" fill="${accent}"/>
  ${details}
  <text x="1090" y="548" text-anchor="end" fill="${ink}" opacity="0.45" font-family="system-ui, sans-serif" font-size="16" font-weight="700" letter-spacing="2">GENERATED BY EXORA</text>
</svg>`, 'utf8')
}

function rememberRender(renderId, svg) {
  if (!renders.has(renderId) && renders.size >= MAX_RENDERS) {
    renders.delete(renders.keys().next().value)
  }
  renders.set(renderId, svg)
}

export function createRenderServer({ publicBaseUrl } = {}) {
  return createServer(async (request, response) => {
    const baseURL = publicBaseUrl || `http://${DEFAULT_HOST}:${DEFAULT_PORT}`
    const requestURL = new URL(request.url || '/', baseURL)

    if (request.method === 'OPTIONS') {
      send(response, 204, 'text/plain; charset=utf-8', '')
      return
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && requestURL.pathname === '/health') {
      sendJSON(response, 200, { status: 'ok', service: 'exora-random-puppy-card-api', version: '2.0.0' })
      return
    }

    const renderMatch = requestURL.pathname.match(/^\/renders\/(render_[a-f0-9]{24})\.svg$/)
    if ((request.method === 'GET' || request.method === 'HEAD') && renderMatch) {
      const svg = renders.get(renderMatch[1])
      if (!svg) {
        sendJSON(response, 404, { code: 'render_not_found', message: 'The puppy card is no longer available.' })
        return
      }
      send(response, 200, 'image/svg+xml; charset=utf-8', request.method === 'HEAD' ? '' : svg, { 'Cache-Control': 'public, max-age=3600' })
      return
    }

    if (request.method === 'POST' && requestURL.pathname === '/v1/puppy-card') {
      try {
        await consumeRequest(request)
        const invocationId = request.headers['x-exora-invocation-id']
        const seed = typeof invocationId === 'string' && invocationId.trim() ? invocationId.trim() : randomUUID()
        const puppy = createPuppy(seed)
        const puppyResult = {
          name: puppy.name,
          age: puppy.age,
          breed: puppy.breed,
          favorite_food: puppy.favorite_food,
          favorite_activity: puppy.favorite_activity,
          favorite_player: puppy.favorite_player,
          home_address: puppy.home_address,
        }
        const renderId = `render_${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`
        const svg = renderSVG(puppy)
        const sha256 = createHash('sha256').update(svg).digest('hex')
        rememberRender(renderId, svg)
        sendJSON(response, 200, {
          render_id: renderId,
          status: 'completed',
          image_url: `${baseURL}/renders/${renderId}.svg`,
          mime_type: 'image/svg+xml',
          sha256,
          bytes: svg.length,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          dog: puppyResult,
        })
      } catch (error) {
        sendJSON(response, 413, { code: 'request_too_large', message: error.message })
      }
      return
    }

    sendJSON(response, 404, { code: 'not_found', message: 'Route not found.' })
  })
}

export async function startRenderServer({ host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  const publicBaseUrl = process.env.EXORA_RENDER_BASE_URL || `http://${host}:${port}`
  const server = createRenderServer({ publicBaseUrl })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  return server
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const host = process.env.EXORA_RENDER_HOST || DEFAULT_HOST
  const port = Number.parseInt(process.env.EXORA_RENDER_PORT || String(DEFAULT_PORT), 10)
  const server = await startRenderServer({ host, port })
  console.log(`[random-puppy-card-api] listening on http://${host}:${port}`)

  const stop = () => server.close(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
