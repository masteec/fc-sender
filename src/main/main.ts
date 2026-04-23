import electron from 'electron';
import type { BrowserWindow } from 'electron';
const { app, BrowserWindow: BW } = electron;
import path from 'path';
import { autoUpdater } from 'electron-updater';
import { WhatsAppService } from './whatsapp';

let mainWindow: BrowserWindow | null = null;
let waService: WhatsAppService | null = null;

function createWindow() {
  mainWindow = new BW({
    width: 1024,
    height: 768,
    title: 'FCSender',
    icon: path.join(__dirname, process.env.VITE_DEV_SERVER_URL ? '../../public/favicon.ico' : '../dist/favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Iniciar el servicio de WhatsApp
  waService = new WhatsAppService(mainWindow);
  waService.start();

  // Evitar que el HTML de React sobrescriba el título de la ventana
  mainWindow.on('page-title-updated', (evt) => {
    evt.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  // Buscar actualizaciones de forma silenciosa al abrir la app
  autoUpdater.checkForUpdatesAndNotify();
});

app.on('window-all-closed', () => {
  if (waService) {
    waService.stop().catch(console.error);
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BW.getAllWindows().length === 0) {
    createWindow();
  }
});
