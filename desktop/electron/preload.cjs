const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('exora', {
  invoke(command, payload) {
    return ipcRenderer.invoke('exora:invoke', command, payload ?? {})
  },
})
