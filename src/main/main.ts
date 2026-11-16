import electron from 'electron';
import type { BrowserWindow, Tray } from 'electron';
import fs from 'fs';
import path from 'path';
import { autoUpdater } from 'electron-updater';
import { WhatsAppService } from './whatsapp';

const { app, BrowserWindow: BW, ipcMain, Menu, Tray: ElectronTray, nativeImage } = electron;

interface UpdaterStatusPayload {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'dev-mode';
  version?: string;
  percent?: number;
  message?: string;
}

let mainWindow: BrowserWindow | null = null;
let waService: WhatsAppService | null = null;
let tray: Tray | null = null;
let isUpdaterInitialized = false;
let latestUpdaterStatus: UpdaterStatusPayload = { state: 'idle' };

if (process.platform === 'win32') {
  app.setAppUserModelId('com.fcsender.app');
}

function resolveAppIconPath(): string {
  const candidates = [
    path.join(__dirname, '../public/favicon.ico'),
    path.join(__dirname, '../dist/favicon.ico'),
    path.join(app.getAppPath(), 'public/favicon.ico'),
    path.join(app.getAppPath(), 'dist/favicon.ico'),
    path.join(__dirname, '../src/renderer/assets/fc-logo.png'),
    path.join(process.resourcesPath || '', 'favicon.ico')
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function emitUpdaterStatus(payload: UpdaterStatusPayload) {
  latestUpdaterStatus = payload;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-status', payload);
  }
}

function setupAutoUpdater() {
  if (isUpdaterInitialized) return;
  isUpdaterInitialized = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    emitUpdaterStatus({ state: 'checking', message: 'Buscando nuevas versiones...' });
  });

  autoUpdater.on('update-available', (info: { version: string }) => {
    emitUpdaterStatus({
      state: 'available',
      version: info.version,
      message: `Nueva versión v${info.version} disponible. Descargando...`
    });
  });

  autoUpdater.on('update-not-available', (info: { version: string }) => {
    emitUpdaterStatus({
      state: 'not-available',
      version: info.version,
      message: `Estás en la versión más reciente (v${app.getVersion()}).`
    });
  });

  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    emitUpdaterStatus({
      state: 'downloading',
      percent: Math.round(progress.percent),
      message: `Descargando actualización: ${Math.round(progress.percent)}%`
    });
  });

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    emitUpdaterStatus({
      state: 'downloaded',
      version: info.version,
      percent: 100,
      message: `Versión v${info.version} lista para instalar.`
    });
  });

  autoUpdater.on('error', (err: Error) => {
    emitUpdaterStatus({
      state: 'error',
      message: `Error al verificar actualizaciones: ${err?.message || 'Error de red'}`
    });
  });

  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('updater-get-status', () => latestUpdaterStatus);

  ipcMain.handle('updater-check', async () => {
    if (!app.isPackaged) {
      const payload: UpdaterStatusPayload = {
        state: 'dev-mode',
        version: app.getVersion(),
        message: 'Modo desarrollo: las actualizaciones OTA se ejecutan en el instalador empaquetado.'
      };
      emitUpdaterStatus(payload);
      return payload;
    }

    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('updater-install', () => {
    if (waService?.isCampaignActive()) {
      return {
        blocked: true,
        message: 'Hay una campaña activa. Detén o finaliza el envío antes de reiniciar para actualizar.'
      };
    }
    autoUpdater.quitAndInstall(false, true);
    return { blocked: false };
  });
}

function setupTray(iconPath: string) {
  if (tray) return;
  const img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) return;

  tray = new ElectronTray(img);
  tray.setToolTip('FCSender Evolution');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir FCSender Evolution',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  const iconPath = resolveAppIconPath();
  const appIcon = nativeImage.createFromPath(iconPath);

  mainWindow = new BW({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: 'FCSender Evolution',
    backgroundColor: '#F4F6F8',
    icon: appIcon.isEmpty() ? iconPath : appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (!appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
  }
  mainWindow.setMenuBarVisibility(false);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  waService = new WhatsAppService(mainWindow);
  waService.start();

  setupTray(iconPath);

  mainWindow.on('page-title-updated', (evt) => {
    evt.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  setupAutoUpdater();
  createWindow();

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      console.error('Error en autoUpdater inicial:', err);
    });
  }
});

app.on('window-all-closed', () => {
  autoUpdater.autoInstallOnAppQuit = !(waService?.isCampaignActive());
  if (tray) {
    tray.destroy();
    tray = null;
  }
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
