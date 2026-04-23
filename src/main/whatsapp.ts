import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode';
import electron from 'electron';
import type { BrowserWindow } from 'electron';
const { ipcMain, app } = electron;
import path from 'path';
import { BulkSenderService, type SendTask } from './bulkSender';

export class WhatsAppService {
  private client: Client;
  private window: BrowserWindow;
  private bulkSender: BulkSenderService | null = null;
  private currentStatus: any = { status: 'CONNECTING', message: 'Iniciando cliente...' };

  constructor(window: BrowserWindow) {
    this.window = window;

    const userDataDir = app.getPath('userData');

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: path.join(userDataDir, 'wwebjs_auth'),
      }),
      webVersionCache: {
        type: 'remote',
        strict: false,
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/'
      },
      puppeteer: {
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ],
      },
    });

    this.initializeEvents();
    this.initializeIPC();
  }

  private emitStatus(payload: any) {
    this.currentStatus = payload;
    if (!this.window.isDestroyed()) {
      this.window.webContents.send('whatsapp-status', payload);
    }
  }

  private initializeEvents() {
    this.client.on('qr', async (qr) => {
      try {
        console.log('QR Code Received');
        const qrDataUrl = await qrcode.toDataURL(qr);
        this.emitStatus({ status: 'DISCONNECTED', qr: qrDataUrl });
      } catch (err) {
        console.error('Error al generar el QR', err);
      }
    });

    this.client.on('loading_screen', (percent, message) => {
      console.log('LOADING SCREEN', percent, message);
      this.emitStatus({ status: 'CONNECTING', message });
    });

    this.client.on('authenticated', () => {
      console.log('AUTHENTICATED');
      this.emitStatus({ status: 'CONNECTING', message: 'Autenticado, sincronizando...' });
    });

    this.client.on('auth_failure', (msg) => {
      console.error('AUTHENTICATION FAILURE', msg);
      this.emitStatus({ status: 'DISCONNECTED', error: 'Fallo de autenticación' });
    });

    this.client.on('ready', () => {
      console.log('READY');
      this.bulkSender = new BulkSenderService(this.client, this.window);
      this.emitStatus({ status: 'READY' });
    });

    this.client.on('disconnected', (reason) => {
      console.log('Cliente desconectado', reason);
      if (this.bulkSender) {
        this.bulkSender.stop();
        this.bulkSender = null;
      }
      this.emitStatus({ status: 'DISCONNECTED', message: 'Sesión finalizada' });
    });
  }
  
  private initializeIPC() {
      ipcMain.removeAllListeners('start-bulk-send');
      ipcMain.removeAllListeners('stop-bulk-send');
      ipcMain.removeAllListeners('get-whatsapp-status');
      
      ipcMain.on('get-whatsapp-status', () => {
          if (!this.window.isDestroyed()) {
              this.window.webContents.send('whatsapp-status', this.currentStatus);
          }
      });

      ipcMain.on('start-bulk-send', (_event, tasks: SendTask[], config: { batchSize: number, restMinutes: number, minDelay: number, maxDelay: number }) => {
          if (this.bulkSender) {
              this.bulkSender.addTasks(tasks, config);
          }
      });
      
      ipcMain.on('stop-bulk-send', () => {
          if (this.bulkSender) {
              this.bulkSender.stop();
          }
      });
  }

  public start() {
    console.log('Iniciando WhatsApp Client...');
    this.client.initialize();
  }

  public async stop() {
    if (this.bulkSender) {
        this.bulkSender.stop();
    }
    if (this.client) {
      await this.client.destroy();
    }
  }
}
