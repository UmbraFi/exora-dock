const { contextBridge, ipcRenderer } = require('electron')

function argValue(name) {
  const prefix = `--${name}=`
  const arg = process.argv.find((item) => item.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : ''
}

const exoraBridge = Object.freeze({
  initialLocale: Object.freeze({
    language: argValue('exora-language') || 'en',
    chromiumLocale: argValue('exora-chromium-locale') || 'en-US',
  }),
  invoke(command, payload) {
    if (typeof command !== 'string' || !command.trim()) {
      return Promise.reject(new Error('Desktop command must be a non-empty string.'))
    }
    return ipcRenderer.invoke('exora:invoke', command, payload ?? {})
  },
  onLocalAgentEvent(callback) {
    if (typeof callback !== 'function') return () => undefined
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('exora:local-agent-event', listener)
    return () => ipcRenderer.removeListener('exora:local-agent-event', listener)
  },
  onV3Progress(callback) {
    if (typeof callback !== 'function') return () => undefined
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('exora:v3-progress', listener)
    return () => ipcRenderer.removeListener('exora:v3-progress', listener)
  },
  onAuthStateChanged(callback) {
    if (typeof callback !== 'function') return () => undefined
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('exora:auth-state-changed', listener)
    return () => ipcRenderer.removeListener('exora:auth-state-changed', listener)
  },
})

contextBridge.exposeInMainWorld('exora', exoraBridge)
