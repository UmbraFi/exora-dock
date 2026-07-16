class RequestTimeoutError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RequestTimeoutError'
    this.code = 'REQUEST_TIMEOUT'
  }
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason
  const error = new Error('request was canceled')
  error.name = 'AbortError'
  error.code = 'REQUEST_ABORTED'
  return error
}

async function fetchAndReadWithTimeout(url, options = {}, timeoutMs, readResponse, fetchImplementation = globalThis.fetch) {
  if (typeof fetchImplementation !== 'function') throw new TypeError('fetch implementation is required')
  if (typeof readResponse !== 'function') throw new TypeError('response reader is required')
  const durationMs = Math.max(1, Number(timeoutMs) || 1)
  const { signal: upstreamSignal, ...fetchOptions } = options || {}
  const controller = new AbortController()
  let timer
  let removeUpstreamAbort = () => undefined
  const timeoutError = new RequestTimeoutError(`request timed out after ${durationMs}ms while receiving the response`)

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError)
      reject(timeoutError)
    }, durationMs)
  })
  const upstreamAbort = new Promise((_, reject) => {
    if (!upstreamSignal) return
    const abort = () => {
      const error = abortError(upstreamSignal)
      controller.abort(error)
      reject(error)
    }
    if (upstreamSignal.aborted) {
      abort()
      return
    }
    upstreamSignal.addEventListener('abort', abort, { once: true })
    removeUpstreamAbort = () => upstreamSignal.removeEventListener('abort', abort)
  })
  const request = (async () => {
    const response = await fetchImplementation(url, { ...fetchOptions, signal: controller.signal })
    const body = await readResponse(response)
    return { response, body }
  })()

  try {
    return await Promise.race([request, timeout, upstreamAbort])
  } finally {
    clearTimeout(timer)
    removeUpstreamAbort()
  }
}

module.exports = { RequestTimeoutError, fetchAndReadWithTimeout }
