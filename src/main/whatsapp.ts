import electron from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
const { ipcMain, app, shell } = electron;

import { BulkSenderService, type SendTask, type BulkSenderConfig } from './bulkSender';
import { BlacklistManager } from './services/blacklistManager';
import { CampaignQueueStore } from './services/queueStore';
import { SettingsManager, type AppSettings } from './services/settingsManager';
import { EmbeddedEvolutionService, type EvolutionConnectionPayload } from './transport/EmbeddedEvolutionService';
import { normalizePhoneDigits } from '../shared/phoneUtils';

export class WhatsAppService {
  private window: BrowserWindow;
  private storageDir: string;
  private evolution: EmbeddedEvolutionService;
  private bulkSender: BulkSenderService;
  private blacklist: BlacklistManager;
  private queueStore: CampaignQueueStore;
  private settingsManager: SettingsManager;
  private currentStatus: EvolutionConnectionPayload = {
    status: 'CONNECTING',
    message: 'Iniciando motor Evolution...'
  };
  private isStartingCampaign = false;

  constructor(window: BrowserWindow) {
    this.window = window;

    const userDataDir = app.getPath('userData');
    this.storageDir = path.join(userDataDir, 'sender_storage');
    const authDir = path.join(userDataDir, 'evolution_auth');

    this.blacklist = new BlacklistManager(this.storageDir);
    this.queueStore = new CampaignQueueStore(this.storageDir);
    this.settingsManager = new SettingsManager(this.storageDir);

    this.blacklist.init().catch(console.error);
    this.queueStore.init().catch(console.error);
    this.settingsManager.init().catch(console.error);

    this.evolution = new EmbeddedEvolutionService(
      authDir,
      (payload) => this.emitStatus(payload),
      (senderDigits, text) => {
        void this.handleIncomingMessage(senderDigits, text);
      }
    );

    this.bulkSender = new BulkSenderService(
      this.window,
      this.evolution,
      this.blacklist,
      this.queueStore
    );

    this.initializeIPC();
  }

  public isCampaignActive(): boolean {
    return this.isStartingCampaign || this.bulkSender.isActive();
  }

  private emitStatus(payload: EvolutionConnectionPayload) {
    this.currentStatus = payload;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('whatsapp-status', payload);
    }
  }

  private async handleIncomingMessage(senderDigits: string, text: string) {
    if (!this.blacklist.isOptOutKeyword(text)) return;
    if (this.blacklist.isBlacklisted(senderDigits)) return;

    const added = await this.blacklist.add(senderDigits, `Baja automática ("${text.slice(0, 30)}")`);
    if (added && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('bulk-log', {
        msg: `[OPT-OUT AUTOMÁTICO] +${added.phone} respondió "${text.slice(0, 30)}" y fue añadido a exclusiones.`,
        type: 'warn'
      });
      this.window.webContents.send('blacklist-updated');
    }
  }

  private async verifyPhoneNumber(rawPhone: string): Promise<{
    phone: string;
    valid: boolean;
    verified: boolean;
    blacklisted: boolean;
  }> {
    const clean = normalizePhoneDigits(rawPhone) || (rawPhone || '').replace(/\D/g, '');
    if (!clean || clean.length < 7) {
      return { phone: `+${clean}`, valid: false, verified: true, blacklisted: false };
    }

    await this.blacklist.init();
    const blacklisted = this.blacklist.isBlacklisted(clean);
    if (!this.evolution.isReady()) {
      return { phone: `+${clean}`, valid: true, verified: false, blacklisted };
    }

    const res = await this.evolution.isRegisteredUser(clean);
    return {
      phone: `+${clean}`,
      valid: res.verified ? res.exists && !blacklisted : !blacklisted,
      verified: res.verified,
      blacklisted
    };
  }

  private initializeIPC() {
    const listeners = [
      'start-bulk-send',
      'stop-bulk-send',
      'resume-bulk-send',
      'retry-failed-send',
      'get-whatsapp-status',
      'get-settings',
      'open-external'
    ];
    for (const ch of listeners) {
      ipcMain.removeAllListeners(ch);
    }

    const handlers = [
      'whatsapp-logout',
      'whatsapp-check-number',
      'whatsapp-check-batch',
      'save-settings-invoke',
      'queue-get-summary',
      'queue-clear',
      'blacklist-get-all',
      'blacklist-add',
      'blacklist-remove',
      'logs-open-folder',
      'reports-open-file'
    ];
    for (const ch of handlers) {
      ipcMain.removeHandler(ch);
    }

    ipcMain.on('get-whatsapp-status', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('whatsapp-status', this.currentStatus);
      }
    });

    ipcMain.handle('whatsapp-logout', async () => {
      if (this.isCampaignActive()) {
        return { ok: false, message: 'Detén la campaña antes de cerrar sesión.' };
      }
      await this.evolution.logout();
      return { ok: true };
    });

    ipcMain.handle('whatsapp-check-number', async (_event, phone: string) => {
      return this.verifyPhoneNumber(phone);
    });

    ipcMain.handle('whatsapp-check-batch', async (_event, phones: string[]) => {
      const results: Record<string, { valid: boolean; verified: boolean; blacklisted: boolean }> = {};
      const chunkSize = 4;
      for (let i = 0; i < phones.length; i += chunkSize) {
        const chunk = phones.slice(i, i + chunkSize);
        const settled = await Promise.all(
          chunk.map(async (p) => {
            const res = await this.verifyPhoneNumber(p);
            return [p, { valid: res.valid, verified: res.verified, blacklisted: res.blacklisted }] as const;
          })
        );
        for (const [p, val] of settled) {
          results[p] = val;
        }
      }
      return results;
    });

    ipcMain.on('get-settings', async () => {
      const settings = await this.settingsManager.init();
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('app-settings-data', settings);
      }
    });

    ipcMain.handle('save-settings-invoke', async (_event, newSettings: Partial<AppSettings>) => {
      const updated = await this.settingsManager.saveSettings(newSettings);
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('app-settings-data', updated);
      }
      return { settings: updated };
    });

    ipcMain.on('start-bulk-send', async (_event, tasks: SendTask[], config: BulkSenderConfig) => {
      if (this.isCampaignActive()) return;
      this.isStartingCampaign = true;
      try {
        const settings = await this.settingsManager.init();
        void this.bulkSender.addTasks(tasks, config, settings);
      } finally {
        this.isStartingCampaign = false;
      }
    });

    ipcMain.on('resume-bulk-send', async (_event, config: BulkSenderConfig) => {
      if (this.isCampaignActive()) return;
      this.isStartingCampaign = true;
      try {
        const settings = await this.settingsManager.init();
        void this.bulkSender.resumePending(config, settings);
      } finally {
        this.isStartingCampaign = false;
      }
    });

    ipcMain.on('retry-failed-send', async (_event, config: BulkSenderConfig) => {
      if (this.isCampaignActive()) return;
      this.isStartingCampaign = true;
      try {
        const settings = await this.settingsManager.init();
        await this.queueStore.init();
        await this.queueStore.retryFailed();
        void this.bulkSender.resumePending(config, settings);
      } finally {
        this.isStartingCampaign = false;
      }
    });

    ipcMain.on('stop-bulk-send', () => {
      this.bulkSender.stop();
    });

    ipcMain.handle('queue-get-summary', async () => {
      await this.queueStore.init();
      return this.queueStore.getSummary();
    });

    ipcMain.handle('queue-clear', async () => {
      if (this.isCampaignActive()) {
        return this.queueStore.getSummary();
      }
      await this.queueStore.init();
      await this.queueStore.clear();
      return this.queueStore.getSummary();
    });

    ipcMain.handle('blacklist-get-all', async () => {
      await this.blacklist.init();
      return {
        entries: this.blacklist.getAll(),
        keywords: this.blacklist.getOptOutKeywords()
      };
    });

    ipcMain.handle('blacklist-add', async (_event, phone: string, reason?: string) => {
      return this.blacklist.add(phone, reason);
    });

    ipcMain.handle('blacklist-remove', async (_event, phone: string) => {
      await this.blacklist.remove(phone);
      return true;
    });

    ipcMain.handle('logs-open-folder', async () => {
      await shell.openPath(this.storageDir);
      return this.storageDir;
    });

    ipcMain.handle('reports-open-file', async (_event, filePath: string) => {
      if (filePath) {
        shell.showItemInFolder(filePath);
      }
      return true;
    });

    ipcMain.on('open-external', (_event, rawUrl: string) => {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          void shell.openExternal(parsed.toString());
        }
      } catch {
        // Ignorar URLs inválidas
      }
    });
  }

  public start() {
    void this.evolution.start();
  }

  public async stop() {
    this.bulkSender.dispose();
    await this.evolution.stop();
  }
}
