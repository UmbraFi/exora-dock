const path = require('node:path')
const { pathToFileURL } = require('node:url')

function createAppURLPolicy(options) {
  const devUrl = String(options?.devUrl || '').trim()
  const distDir = path.resolve(String(options?.distDir || 'dist'))
  const devOrigin = safeURL(devUrl)?.origin || ''
  return Object.freeze({
    isPackaged: Boolean(options?.isPackaged),
    devOrigin,
    distRootHref: pathToFileURL(`${distDir}${path.sep}`).href,
  })
}

function installNavigationGuards(browserWindow, options = {}) {
  const policy = options.policy
  const shell = options.shell
  const openExternal = async (url) => {
    if (!shell || !isExternalOpenAllowed(url)) return
    await shell.openExternal(url)
  }

  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url).catch((error) => {
      console.error('Failed to open external URL:', error)
    })
    return { action: 'deny' }
  })

  browserWindow.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppURL(url, policy)) return
    event.preventDefault()
    openExternal(url).catch((error) => {
      console.error('Failed to open external URL:', error)
    })
  })
}

function isTrustedIpcSender(event, policy) {
  const url = event?.senderFrame?.url || event?.sender?.getURL?.() || ''
  return isTrustedAppURL(url, policy)
}

function isTrustedAppURL(value, policy) {
  const url = safeURL(value)
  if (!url || !policy) return false
  if (policy.isPackaged) {
    return url.protocol === 'file:' && url.href.startsWith(policy.distRootHref)
  }
  return Boolean(policy.devOrigin && url.origin === policy.devOrigin)
}

function isExternalOpenAllowed(value) {
  const url = safeURL(value)
  if (!url) return false
  return ['https:', 'http:', 'mailto:'].includes(url.protocol)
}

function safeURL(value) {
  try {
    return new URL(String(value || ''))
  } catch {
    return undefined
  }
}

module.exports = {
  createAppURLPolicy,
  installNavigationGuards,
  isExternalOpenAllowed,
  isTrustedAppURL,
  isTrustedIpcSender,
}
