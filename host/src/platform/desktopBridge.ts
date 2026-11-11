export type DesktopListener = (event: { senderId?: number }, ...args: any[]) => void;

export interface DesktopBridge {
  send(channel: string, ...args: any[]): void;
  invoke<T = any>(channel: string, ...args: any[]): Promise<T>;
  on(channel: string, listener: DesktopListener): DesktopBridge;
  removeListener(channel: string, listener: DesktopListener): DesktopBridge;
}

type TauriGlobal = {
  core?: { invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
  event?: {
    listen?: (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;
  };
};

type WindowWithDesktopRuntimes = Window & {
  require?: (name: string) => { ipcRenderer?: DesktopBridge };
  __TAURI__?: TauriGlobal;
};

const tauriSubscriptions = new WeakMap<DesktopListener, Map<string, Promise<() => void>[]>>();

const tauriBridge: DesktopBridge = {
  send(channel, ...args) {
    const invoke = (window as WindowWithDesktopRuntimes).__TAURI__?.core?.invoke;
    if (!invoke) return;
    void invoke('ipc_send', { channel, args });
  },
  invoke<T>(channel: string, ...args: any[]): Promise<T> {
    const invoke = (window as WindowWithDesktopRuntimes).__TAURI__?.core?.invoke;
    if (!invoke) return Promise.reject(new Error('Tauri command bridge is unavailable'));
    return invoke<T>('ipc_invoke', { channel, args });
  },
  on(channel, listener) {
    const listen = (window as WindowWithDesktopRuntimes).__TAURI__?.event?.listen;
    if (!listen) return this;
    const pending = listen(channel, event => listener({}, event.payload));
    let channels = tauriSubscriptions.get(listener);
    if (!channels) {
      channels = new Map();
      tauriSubscriptions.set(listener, channels);
    }
    const list = channels.get(channel) || [];
    list.push(pending);
    channels.set(channel, list);
    return this;
  },
  removeListener(channel, listener) {
    const channels = tauriSubscriptions.get(listener);
    const list = channels?.get(channel);
    if (list && list.length > 0) {
      const pending = list.pop();
      if (list.length === 0) channels?.delete(channel);
      if (pending) void pending.then(unlisten => unlisten());
    }
    return this;
  },
};

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const runtime = window as WindowWithDesktopRuntimes;
  if (runtime.__TAURI__?.core?.invoke) return tauriBridge;
  try {
    const electron = runtime.require?.('electron')?.ipcRenderer;
    if (electron) return electron;
  } catch (_) {}
  return null;
}

export function isDesktopRuntime(): boolean {
  return getDesktopBridge() !== null;
}

