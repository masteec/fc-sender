import { contextBridge, ipcRenderer } from 'electron';

// FASE 4: Auditoría de canales IPC robustecida
contextBridge.exposeInMainWorld('electronAPI', {
  // Control de sesión
  onWhatsAppStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('whatsapp-status', handler);
    return () => ipcRenderer.removeListener('whatsapp-status', handler);
  },
  getWhatsAppStatus: () => ipcRenderer.send('get-whatsapp-status'),
  
  // Disparadores del proceso de envío
  startBulkSend: (tasks: any[], config: any) => ipcRenderer.send('start-bulk-send', tasks, config),
  stopBulkSend: () => ipcRenderer.send('stop-bulk-send'),

  // Sincronización de estado e interfaces
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