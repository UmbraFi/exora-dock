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

test('IPC deadlines release a stalled command', async () => {
  let invokeHandler
  const ipcMain = { handle: (_channel, handler) => { invokeHandler = handler } }
  registerIpcHandlers(ipcMain, {
    wallet: { wallet_status: async () => new Promise(() => undefined) },
  }, {
    timeoutForCommand: () => 15,
  })

  await assert.rejects(
    invokeHandler({}, 'wallet_status', {}),
    (error) => error?.code === 'IPC_COMMAND_TIMEOUT' && /interface has been released/i.test(error.message),
  )
})
