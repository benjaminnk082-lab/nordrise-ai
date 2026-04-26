import { contextBridge, ipcRenderer } from 'electron';

const api = {
  invoke: <T = unknown>(channel: string, payload?: unknown) =>
    ipcRenderer.invoke(channel, payload) as Promise<T>,

  on: (channel: string, listener: (...args: unknown[]) => void) => {
    const wrapped = (_evt: unknown, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(channel, wrapped as never);
    return () => ipcRenderer.removeListener(channel, wrapped as never);
  },

  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
  },
};

contextBridge.exposeInMainWorld('nordrise', api);
export type NordriseBridge = typeof api;
