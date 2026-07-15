type ExoraBridge = {
  isPackaged?: boolean
  initialLocale?: {
    language?: 'en' | 'zh'
    chromiumLocale?: string
  }
  invoke<T = unknown>(command: string, payload?: Record<string, unknown>): Promise<T>
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
      return Promise.resolve({ version: 2, settings: {} } as T)
    }
    if (developmentPreview && ['window_set_mode', 'window_minimize', 'window_toggle_maximize', 'window_close'].includes(command)) {
      return Promise.resolve(undefined as T)
    }
    return Promise.reject(new Error('Exora Desktop bridge is not available. Open this screen in the Electron app.'))
  }
  return window.exora.invoke<T>(command, payload)
}
