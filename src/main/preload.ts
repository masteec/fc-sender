import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';

type Listener<T> = (data: T) => void;

function subscribe<T>(channel: string, callback: Listener<T>) {
  const handler = (_event: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  onWhatsAppStatus: (cb: Listener<unknown>) => subscribe('whatsapp-status', cb),
  getWhatsAppStatus: () => ipcRenderer.send('get-whatsapp-status'),
  logoutWhatsApp: () => ipcRenderer.invoke('whatsapp-logout'),
  checkWhatsAppNumber: (phone: string) => ipcRenderer.invoke('whatsapp-check-number', phone),
  checkWhatsAppBatch: (phones: string[]) => ipcRenderer.invoke('whatsapp-check-batch', phones),

  getSettings: () => ipcRenderer.send('get-settings'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('save-settings-invoke', settings),
  onAppSettingsData: (cb: Listener<unknown>) => subscribe('app-settings-data', cb),

  startBulkSend: (tasks: unknown[], config: unknown) => ipcRenderer.send('start-bulk-send', tasks, config),
  resumeBulkSend: (config: unknown) => ipcRenderer.send('resume-bulk-send', config),
  retryFailedSend: (config: unknown) => ipcRenderer.send('retry-failed-send', config),
  stopBulkSend: () => ipcRenderer.send('stop-bulk-send'),
  getQueueSummary: () => ipcRenderer.invoke('queue-get-summary'),
  clearQueue: () => ipcRenderer.invoke('queue-clear'),

  getBlacklist: () => ipcRenderer.invoke('blacklist-get-all'),
  addToBlacklist: (phone: string, reason?: string) => ipcRenderer.invoke('blacklist-add', phone, reason),
  removeFromBlacklist: (phone: string) => ipcRenderer.invoke('blacklist-remove', phone),
  onBlacklistUpdated: (cb: Listener<void>) => subscribe('blacklist-updated', cb),

  openLogsFolder: () => ipcRenderer.invoke('logs-open-folder'),
  openReportFile: (filePath: string) => ipcRenderer.invoke('reports-open-file', filePath),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),

  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getUpdaterStatus: () => ipcRenderer.invoke('updater-get-status'),
  checkForUpdates: () => ipcRenderer.invoke('updater-check'),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
  onUpdaterStatus: (cb: Listener<unknown>) => subscribe('updater-status', cb),

  onBulkSenderUpdate: (cb: Listener<unknown>) => subscribe('bulk-update', cb),
  onBulkSenderProgress: (cb: Listener<unknown>) => subscribe('bulk-progress', cb),
  onBulkSenderDelay: (cb: Listener<unknown>) => subscribe('bulk-delay', cb),
  onBulkSenderLog: (cb: Listener<unknown>) => subscribe('bulk-log', cb),
  onBulkSenderFinish: (cb: Listener<unknown>) => subscribe('bulk-finish', cb)
});
