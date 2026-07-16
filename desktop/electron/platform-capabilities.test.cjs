const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  VM_PROVIDER_COMMANDS,
  assertDesktopCommandSupported,
  desktopCapabilities,
} = require('./platform-capabilities.cjs')

test('macOS disables the local VM provider without disabling remote compute consumption', () => {
  assert.equal(desktopCapabilities('darwin').vmProvider, false)
  assert.equal(desktopCapabilities('win32').vmProvider, true)
  assert.equal(desktopCapabilities('linux').vmProvider, true)

  for (const command of VM_PROVIDER_COMMANDS) {
    assert.throws(
      () => assertDesktopCommandSupported(command, 'darwin'),
      /VM Provider is not available on macOS/,
    )
  }

  assert.doesNotThrow(() => assertDesktopCommandSupported('consumer_purchase_compute', 'darwin'))
  assert.doesNotThrow(() => assertDesktopCommandSupported('provider_listing_action', 'darwin'))
})

test('every VM provider IPC command registered by the desktop is platform-gated', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
  const registeredCommands = new Set(Array.from(
    main.matchAll(/^      (provider_(?:vm|runtime|host|environment)_[a-z_]+),$/gm),
    (match) => match[1],
  ))
  assert.deepEqual([...registeredCommands].sort(), [...VM_PROVIDER_COMMANDS].sort())
})
