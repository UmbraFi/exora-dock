const { contextBridge, ipcRenderer } = require('electron')

function argValue(name) {
  const prefix = `--${name}=`
  const arg = process.argv.find((item) => item.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : ''
}

contextBridge.exposeInMainWorld('exora', {
  initialLocale: {
    language: argValue('exora-language') || 'en',
    chromiumLocale: argValue('exora-chromium-locale') || 'en-US',
  },
  invoke(command, payload) {
    return ipcRenderer.invoke('exora:invoke', command, payload ?? {})
  },
})
