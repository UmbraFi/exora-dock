const DEFAULT_CHANNEL = 'exora:invoke'

function registerIpcHandlers(ipcMain, groups, options = {}) {
  const channel = options.channel || DEFAULT_CHANNEL
  const handlers = flattenIpcHandlers(groups)
  const validateSender = typeof options.validateSender === 'function'
    ? options.validateSender
    : () => true
  const authorizeCommand = typeof options.authorizeCommand === 'function'
    ? options.authorizeCommand
    : () => undefined

  ipcMain.handle(channel, async (event, command, payload = {}) => {
    if (!validateSender(event)) {
      throw new Error('untrusted desktop IPC sender')
    }
    if (typeof command !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, command)) {
      throw new Error(`unknown desktop command: ${String(command)}`)
    }
    await authorizeCommand(command, payload, event)
    return handlers[command](payload, event)
  })

  return handlers
}

function flattenIpcHandlers(groups) {
  const handlers = {}
  for (const [groupName, group] of Object.entries(groups || {})) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      throw new Error(`IPC handler group ${groupName} must be an object`)
    }
    for (const [command, handler] of Object.entries(group)) {
      if (typeof handler !== 'function') {
        throw new Error(`IPC handler ${groupName}.${command} must be a function`)
      }
      if (Object.prototype.hasOwnProperty.call(handlers, command)) {
        throw new Error(`duplicate IPC command: ${command}`)
      }
      handlers[command] = handler
    }
  }
  return Object.freeze(handlers)
}

module.exports = {
  DEFAULT_CHANNEL,
  flattenIpcHandlers,
  registerIpcHandlers,
}
