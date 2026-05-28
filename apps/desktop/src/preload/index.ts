import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type IpcChannel,
  type ThreadStartRequest,
  type ThreadStartResult,
  type ThreadSummary,
  type WorkspaceInfo,
  type WorkspaceOpenResult,
} from "../shared/ipc";

type InvokePayload = Record<string, unknown> | undefined;

const api = {
  channels: IPC_CHANNELS,
  invoke(channel: IpcChannel, payload?: InvokePayload): Promise<unknown> {
    return ipcRenderer.invoke(channel, payload);
  },
  openWorkspace(): Promise<WorkspaceOpenResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceOpen);
  },
  getCurrentWorkspace(): Promise<WorkspaceInfo | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceGetCurrent);
  },
  startThread(request: ThreadStartRequest): Promise<ThreadStartResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadStart, request);
  },
  listThreads(): Promise<ThreadSummary[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadList);
  },
  onThreadEvent(callback: (event: unknown) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.threadEventsSubscribe, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.threadEventsSubscribe, listener);
  },
};

contextBridge.exposeInMainWorld("eco", api);

export type EcoDesktopApi = typeof api;
