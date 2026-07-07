type ExoraBridge = {
  initialLocale?: {
    language?: 'en' | 'zh'
    chromiumLocale?: string
  }
  invoke<T = unknown>(command: string, payload?: Record<string, unknown>): Promise<T>
}

declare global {
  interface Window {
    exora?: ExoraBridge
  }
}

export function invoke<T = unknown>(command: string, payload?: Record<string, unknown>): Promise<T> {
  if (!window.exora?.invoke) {
    return Promise.reject(new Error('Exora Desktop bridge is not available. Open this screen in the Electron app.'))
  }
  return window.exora.invoke<T>(command, payload)
}
