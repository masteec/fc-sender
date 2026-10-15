import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Estado y conexión de Evolution Engine
  onWhatsAppStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('whatsapp-status', handler);
    return () => ipcRenderer.removeListener('whatsapp-status', handler);
  },
  getWhatsAppStatus: () => ipcRenderer.send('get-whatsapp-status'),
  logoutWhatsApp: () => ipcRenderer.invoke('logout-whatsapp'),

  // Utilidades de Archivos y Multimedia
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return (file as any).path || '';
    }
  },
  saveTempMedia: (fileName: string, buffer: ArrayBuffer) => ipcRenderer.invoke('save-temp-media', fileName, buffer),

  // Validación de Números y Sistema de Reputación
  validateNumbers: (numbers: string[]) => ipcRenderer.invoke('validate-numbers', numbers),

  // Gestión de Lista Negra (Opt-Out)
  getBlacklist: () => ipcRenderer.invoke('get-blacklist'),
  addToBlacklist: (phone: string, reason?: string) => ipcRenderer.invoke('add-to-blacklist', phone, reason),
  removeFromBlacklist: (phone: string) => ipcRenderer.invoke('remove-from-blacklist', phone),
  clearBlacklist: () => ipcRenderer.invoke('clear-blacklist'),
  onBlacklistUpdated: (callback: (data: any[]) => void) => {
    const handler = (_event: any, data: any[]) => callback(data);
    ipcRenderer.on('blacklist-updated', handler);
    return () => ipcRenderer.removeListener('blacklist-updated', handler);
  },

  // Control de Envíos Masivos
  startBulkSend: (tasks: any[], config: any) => ipcRenderer.send('start-bulk-send', tasks, config),
  stopBulkSend: () => ipcRenderer.send('stop-bulk-send'),

  // Eventos de monitoreo en tiempo real
  onBulkSenderUpdate: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('bulk-update', handler);
    return () => ipcRenderer.removeListener('bulk-update', handler);
  },

  onBulkSenderProgress: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('bulk-progress', handler);
    return () => ipcRenderer.removeListener('bulk-progress', handler);
  },

  onBulkSenderDelay: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('bulk-delay', handler);
    return () => ipcRenderer.removeListener('bulk-delay', handler);
  },

  onBulkSenderLog: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('bulk-log', handler);
    return () => ipcRenderer.removeListener('bulk-log', handler);
  },

  onBulkSenderFinish: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('bulk-finish', handler);
    return () => ipcRenderer.removeListener('bulk-finish', handler);
  }
});