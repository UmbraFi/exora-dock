const assert = require('node:assert/strict')
const test = require('node:test')
const { registerIpcHandlers } = require('./ipc.cjs')

test('IPC authorization runs before a supported command handler', async () => {
  let invokeHandler
  let handled = false
  const ipcMain = { handle: (_channel, handler) => { invokeHandler = handler } }

  registerIpcHandlers(ipcMain, {
    provider: {
      provider_vm_probe: async () => { handled = true },
    },
  }, {
    authorizeCommand: (command) => {
      assert.equal(command, 'provider_vm_probe')
      throw new Error('unsupported platform command')
    },
  })

  await assert.rejects(
    invokeHandler({}, 'provider_vm_probe', {}),
    /unsupported platform command/,
  )
  assert.equal(handled, false)
})
