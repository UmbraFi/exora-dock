type ExoraBridge = {
  isPackaged?: boolean
  initialLocale?: {
    language?: 'en' | 'zh'
    chromiumLocale?: string
  }
  invoke<T = unknown>(command: string, payload?: Record<string, unknown>): Promise<T>
  getPathForFile?(file: File): string
  onV3Progress?(callback: (payload: unknown) => void): () => void
  onAuthStateChanged?(callback: (payload: unknown) => void): () => void
}

declare global {
  interface Window {
    exora?: ExoraBridge
  }
}

export function invoke<T = unknown>(command: string, payload?: Record<string, unknown>): Promise<T> {
  if (!window.exora?.invoke) {
    const developmentPreview = window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1'
    if (developmentPreview && command === 'app_settings_load') {
      return Promise.resolve({ version: 3, settings: {} } as T)
    }
    if (developmentPreview && ['window_set_mode', 'window_minimize', 'window_toggle_maximize', 'window_close'].includes(command)) {
      return Promise.resolve(undefined as T)
    }
    if (developmentPreview && ['app_status', 'start_dock', 'stop_dock', 'restart_dock'].includes(command)) {
      const running = command !== 'stop_dock'
      return Promise.resolve({ docker: 'native', container: running ? 'running' : 'stopped', daemon: running ? 'healthy' : 'offline', image: 'available', containerName: 'exora-dockd', imageTag: 'preview', baseUrl: 'http://127.0.0.1:8080', dataDir: '', configPath: '', discoveryPath: '', mcpCommand: '', agentPrompt: '', opencodeConfig: '', message: running ? 'Dock is ready for local Agent connections.' : 'Dock is stopped.' } as T)
    }
    if (developmentPreview && ['copy_mcp_command', 'copy_opencode_config'].includes(command)) {
      return Promise.resolve((command === 'copy_opencode_config' ? '{"mcp":{"exora-dock":{"command":"exora-dockd"}}}' : 'exora-dockd --config ./config.yaml') as T)
    }
    if (developmentPreview && command === 'system_update_check') {
      return Promise.resolve({ supported: false, channel: 'stable', state: 'development', message: 'Updates are disabled in the browser preview.' } as T)
    }
    if (developmentPreview && command === 'system_choose_download_directory') return Promise.resolve({ canceled: true, path: '' } as T)
    if (developmentPreview && command === 'system_export_diagnostics') return Promise.resolve({ canceled: true } as T)
    if (developmentPreview && ['save_app_settings', 'set_locale', 'system_notification_test', 'system_open_path', 'system_clear_storage', 'system_open_legal'].includes(command)) return Promise.resolve({ ok: true } as T)
    return Promise.reject(new Error('Exora Desktop bridge is not available. Open this screen in the Electron app.'))
  }
  return window.exora.invoke<T>(command, payload)
}
