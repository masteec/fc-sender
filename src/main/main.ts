import electron from 'electron';
import type { BrowserWindow } from 'electron';
const { app, BrowserWindow: BW } = electron;
import path from 'path';
import { autoUpdater } from 'electron-updater';
import { EvolutionService } from './evolutionService';

let mainWindow: BrowserWindow | null = null;
let evolutionService: EvolutionService | null = null;

function createWindow() {
  mainWindow = new BW({
    width: 1120,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    title: 'FCSender - Distribución Interna de Comunicaciones',
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

  // Iniciar el motor local de Evolution API
  evolutionService = new EvolutionService(mainWindow);
  evolutionService.start();

  // Evitar que el HTML sobrescriba el título de la ventana
  mainWindow.on('page-title-updated', (evt) => {
    evt.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  // Buscar actualizaciones en producción
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});

app.on('window-all-closed', () => {
  if (evolutionService) {
    evolutionService.stop().catch(console.error);
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
