import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8792
const MAX_REQUEST_BYTES = 64 * 1024
const MAX_DRAWS = 200
const IMAGE_WIDTH = 1440
const IMAGE_HEIGHT = 760

const majorArcana = [
  ['The Fool', 'New beginnings and open possibilities', 'Recklessness and poor preparation'],
  ['The Magician', 'Skill, focus, and manifestation', 'Manipulation or scattered energy'],
  ['The High Priestess', 'Intuition and hidden knowledge', 'Secrets ignored or inner confusion'],
  ['The Empress', 'Creativity, care, and abundance', 'Creative blocks or dependence'],
  ['The Emperor', 'Structure, authority, and stability', 'Rigidity or misuse of control'],
  ['The Hierophant', 'Tradition, learning, and guidance', 'Rebellion or limiting convention'],
  ['The Lovers', 'Harmony, values, and meaningful choice', 'Imbalance or conflicting values'],
  ['The Chariot', 'Determination and forward movement', 'Loss of direction or aggression'],
  ['Strength', 'Courage, patience, and compassion', 'Self-doubt or uncontrolled emotion'],
  ['The Hermit', 'Reflection and inner guidance', 'Isolation or avoidance'],
  ['Wheel of Fortune', 'Change, cycles, and opportunity', 'Resistance to change or setbacks'],
  ['Justice', 'Fairness, truth, and accountability', 'Bias, avoidance, or dishonesty'],
  ['The Hanged Man', 'Pause, surrender, and new perspective', 'Stalling or needless sacrifice'],
  ['Death', 'Transformation and necessary endings', 'Fear of change or stagnation'],
  ['Temperance', 'Balance, patience, and integration', 'Excess or lack of alignment'],
  ['The Devil', 'Attachment, temptation, and shadow work', 'Release, awareness, and reclaiming power'],
  ['The Tower', 'Sudden truth and disruptive change', 'Avoiding the inevitable or prolonged tension'],
  ['The Star', 'Hope, renewal, and inspiration', 'Discouragement or lost faith'],
  ['The Moon', 'Dreams, uncertainty, and intuition', 'Clarity emerging or fear dissolving'],
  ['The Sun', 'Joy, vitality, and success', 'Temporary doubt or delayed happiness'],
  ['Judgement', 'Awakening, reflection, and a calling', 'Self-doubt or refusal to learn'],
  ['The World', 'Completion, integration, and fulfillment', 'Unfinished work or delayed closure'],
].map(([name, upright, reversed], number) => ({
  id: `major_${number}`,
  name,
  arcana: 'Major Arcana',
  suit: 'Major',
  number,
  upright,
  reversed,
}))

const suits = [
  { name: 'Wands', domain: 'passion, creativity, and action' },
  { name: 'Cups', domain: 'emotion, intuition, and relationships' },
  { name: 'Swords', domain: 'thought, truth, and conflict' },
  { name: 'Pentacles', domain: 'work, resources, and stability' },
]

const ranks = [
  ['Ace', 'a new beginning'],
  ['Two', 'choice and balance'],
  ['Three', 'growth and collaboration'],
  ['Four', 'stability and reflection'],
  ['Five', 'challenge and adjustment'],
  ['Six', 'movement and restoration'],
  ['Seven', 'assessment and perseverance'],
  ['Eight', 'momentum and mastery'],
  ['Nine', 'resilience and nearing completion'],
  ['Ten', 'completion and transition'],
  ['Page', 'curiosity and a new message'],
  ['Knight', 'pursuit and bold movement'],
  ['Queen', 'maturity and inner command'],
  ['King', 'leadership and outward command'],
]

const minorArcana = suits.flatMap((suit) => ranks.map(([rank, theme], index) => ({
  id: `${suit.name.toLowerCase()}_${index + 1}`,
  name: `${rank} of ${suit.name}`,
  arcana: 'Minor Arcana',
  suit: suit.name,
  number: index + 1,
  upright: `${theme[0].toUpperCase()}${theme.slice(1)} in ${suit.domain}`,
  reversed: `Blocked ${theme} or imbalance in ${suit.domain}`,
})))

const tarotDeck = [...majorArcana, ...minorArcana]
const positions = ['PAST', 'PRESENT', 'FUTURE']
const suitColors = {
  Major: ['#7C3AED', '#C4B5FD'],
  Wands: ['#C2410C', '#FDBA74'],
  Cups: ['#0369A1', '#7DD3FC'],
  Swords: ['#475569', '#CBD5E1'],
  Pentacles: ['#047857', '#6EE7B7'],
}

const draws = new Map()

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
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) throw new Error('Request body exceeds 65536 bytes.')
    chunks.push(chunk)
  }

  if (size === 0) return

  let body
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Request body must be valid JSON when provided.')
    error.code = 'invalid_input'
    throw error
  }

  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length > 0) {
    const error = new Error('This zero-input operation accepts only an empty JSON object.')
    error.code = 'invalid_input'
    throw error
  }
}

function score(seed, value) {
  return createHash('sha256').update(`${seed}:${value}`).digest('hex')
}

function drawCards(seed) {
  return tarotDeck
    .map((card) => ({ card, order: score(seed, card.id) }))
    .sort((left, right) => left.order.localeCompare(right.order))
    .slice(0, 3)
    .map(({ card }, index) => {
      const orientation = Number.parseInt(score(seed, `${card.id}:orientation`).slice(0, 2), 16) % 2 === 0 ? 'UPRIGHT' : 'REVERSED'
      return {
        position: positions[index],
        name: card.name,
        arcana: card.arcana,
        suit: card.suit,
        orientation,
        meaning: orientation === 'UPRIGHT' ? card.upright : card.reversed,
      }
    })
}

function textLines(text, maximumCharacters = 34) {
  const words = text.split(/\s+/)
  const lines = []
  for (const word of words) {
    const last = lines.at(-1)
    if (!last || `${last} ${word}`.length > maximumCharacters) lines.push(word)
    else lines[lines.length - 1] = `${last} ${word}`
  }
  return lines.slice(0, 3)
}

function renderCard(card, index) {
  const x = 80 + index * 450
  const [primary, accent] = suitColors[card.suit]
  const meaningLines = textLines(card.meaning)
  const nameLines = textLines(card.name, 22)
  const orientationMark = card.orientation === 'UPRIGHT' ? '▲' : '▼'
  const nameSVG = nameLines.map((line, lineIndex) => `<text x="${x + 190}" y="${290 + lineIndex * 42}" text-anchor="middle" fill="#F8FAFC" font-family="Georgia, serif" font-size="34" font-weight="700">${escapeXML(line)}</text>`).join('\n  ')
  const meaningSVG = meaningLines.map((line, lineIndex) => `<text x="${x + 190}" y="${503 + lineIndex * 28}" text-anchor="middle" fill="#E2E8F0" font-family="system-ui, sans-serif" font-size="19">${escapeXML(line)}</text>`).join('\n  ')

  return `<g>
  <rect x="${x}" y="116" width="380" height="570" rx="24" fill="#0F172A" stroke="${accent}" stroke-width="5"/>
  <rect x="${x + 17}" y="133" width="346" height="536" rx="17" fill="none" stroke="${primary}" stroke-width="2" opacity="0.9"/>
  <circle cx="${x + 190}" cy="218" r="62" fill="${primary}" opacity="0.38"/>
  <circle cx="${x + 190}" cy="218" r="43" fill="none" stroke="${accent}" stroke-width="3"/>
  <path d="M${x + 190} 177 L${x + 202} 207 L${x + 234} 209 L${x + 209} 229 L${x + 217} 260 L${x + 190} 242 L${x + 163} 260 L${x + 171} 229 L${x + 146} 209 L${x + 178} 207 Z" fill="${accent}" opacity="0.9"/>
  ${nameSVG}
  <text x="${x + 190}" y="407" text-anchor="middle" fill="${accent}" font-family="system-ui, sans-serif" font-size="18" font-weight="800" letter-spacing="3">${escapeXML(card.suit.toUpperCase())}</text>
  <line x1="${x + 70}" y1="435" x2="${x + 310}" y2="435" stroke="${primary}" stroke-width="2"/>
  <text x="${x + 190}" y="470" text-anchor="middle" fill="${accent}" font-family="system-ui, sans-serif" font-size="17" font-weight="800" letter-spacing="2">${orientationMark} ${card.orientation}</text>
  ${meaningSVG}
  <text x="${x + 190}" y="642" text-anchor="middle" fill="${accent}" font-family="system-ui, sans-serif" font-size="18" font-weight="800" letter-spacing="4">${card.position}</text>
</g>`
}

function renderSVG(cards) {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}" role="img" aria-label="Three-card tarot reading">
  <defs>
    <radialGradient id="sky" cx="50%" cy="0%" r="90%"><stop offset="0" stop-color="#312E81"/><stop offset="1" stop-color="#020617"/></radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#sky)"/>
  <circle cx="90" cy="80" r="3" fill="#FDE68A"/><circle cx="190" cy="45" r="2" fill="#FDE68A"/>
  <circle cx="1230" cy="62" r="3" fill="#FDE68A"/><circle cx="1340" cy="115" r="2" fill="#FDE68A"/>
  <text x="720" y="62" text-anchor="middle" fill="#F8FAFC" font-family="Georgia, serif" font-size="40" font-weight="700" letter-spacing="5">THREE-CARD TAROT READING</text>
  ${cards.map(renderCard).join('\n  ')}
  <text x="720" y="730" text-anchor="middle" fill="#C4B5FD" opacity="0.72" font-family="system-ui, sans-serif" font-size="15" font-weight="700" letter-spacing="4">GENERATED LOCALLY FOR EXORA · FOR ENTERTAINMENT ONLY</text>
</svg>`, 'utf8')
}

function rememberDraw(drawId, svg) {
  if (!draws.has(drawId) && draws.size >= MAX_DRAWS) draws.delete(draws.keys().next().value)
  draws.set(drawId, svg)
}

export function createTarotServer({ publicBaseUrl } = {}) {
  return createServer(async (request, response) => {
    const baseURL = publicBaseUrl || `http://${DEFAULT_HOST}:${DEFAULT_PORT}`
    const requestURL = new URL(request.url || '/', baseURL)

    if (request.method === 'OPTIONS') {
      send(response, 204, 'text/plain; charset=utf-8', '')
      return
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && requestURL.pathname === '/health') {
      sendJSON(response, 200, { status: 'ok', service: 'exora-random-tarot-api', version: '1.0.0' })
      return
    }

    const drawMatch = requestURL.pathname.match(/^\/draws\/(draw_[a-f0-9]{24})\.svg$/)
    if ((request.method === 'GET' || request.method === 'HEAD') && drawMatch) {
      const svg = draws.get(drawMatch[1])
      if (!svg) {
        sendJSON(response, 404, { code: 'draw_not_found', message: 'The tarot draw is no longer available.' })
        return
      }
      send(response, 200, 'image/svg+xml; charset=utf-8', request.method === 'HEAD' ? '' : svg, { 'Cache-Control': 'public, max-age=3600' })
      return
    }

    if (request.method === 'POST' && requestURL.pathname === '/v1/draw-three') {
      try {
        await consumeRequest(request)
        const invocationId = request.headers['x-exora-invocation-id']
        const seed = typeof invocationId === 'string' && invocationId.trim() ? invocationId.trim() : randomUUID()
        const cards = drawCards(seed)
        const drawId = `draw_${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`
        const svg = renderSVG(cards)
        rememberDraw(drawId, svg)
        sendJSON(response, 200, {
          draw_id: drawId,
          status: 'completed',
          image_url: `${baseURL}/draws/${drawId}.svg`,
          mime_type: 'image/svg+xml',
          sha256: createHash('sha256').update(svg).digest('hex'),
          bytes: svg.length,
          width: IMAGE_WIDTH,
          height: IMAGE_HEIGHT,
          cards,
          disclaimer: 'For entertainment and personal reflection only.',
        })
      } catch (error) {
        const invalidInput = error.code === 'invalid_input'
        sendJSON(response, invalidInput ? 400 : 413, {
          code: invalidInput ? 'invalid_input' : 'request_too_large',
          message: error.message,
        })
      }
      return
    }

    sendJSON(response, 404, { code: 'not_found', message: 'Route not found.' })
  })
}

export async function startTarotServer({ host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  const publicBaseUrl = process.env.EXORA_TAROT_BASE_URL || `http://${host}:${port}`
  const server = createTarotServer({ publicBaseUrl })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  return server
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const host = process.env.EXORA_TAROT_HOST || DEFAULT_HOST
  const port = Number.parseInt(process.env.EXORA_TAROT_PORT || String(DEFAULT_PORT), 10)
  const server = await startTarotServer({ host, port })
  console.log(`[random-tarot-api] listening on http://${host}:${port}`)

  const stop = () => server.close(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
