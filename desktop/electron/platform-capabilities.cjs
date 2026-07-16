const VM_PROVIDER_COMMANDS = Object.freeze([
  'provider_vm_probe',
  'provider_vm_capacity',
  'provider_vm_domains',
  'provider_vm_import',
  'provider_vm_validate',
  'provider_runtime_status',
  'provider_host_snapshot',
  'provider_host_scan',
  'provider_environment_catalog',
  'provider_environment_storage',
  'provider_environment_choose_root',
  'provider_environment_update_storage',
  'provider_environment_download',
  'provider_environment_cancel',
  'provider_environment_installed',
  'provider_environment_delete',
  'provider_environment_reserve',
  'provider_environment_release',
])

const vmProviderCommands = new Set(VM_PROVIDER_COMMANDS)

function desktopCapabilities(platform = process.platform) {
  return Object.freeze({
    vmProvider: platform !== 'darwin',
  })
}

function assertDesktopCommandSupported(command, platform = process.platform) {
  if (!desktopCapabilities(platform).vmProvider && vmProviderCommands.has(command)) {
    throw new Error('VM Provider is not available on macOS in this release.')
  }
}

module.exports = {
  VM_PROVIDER_COMMANDS,
  assertDesktopCommandSupported,
  desktopCapabilities,
}
