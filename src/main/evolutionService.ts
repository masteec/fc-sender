import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type ConnectionState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import electron from 'electron';
import type { BrowserWindow } from 'electron';
const { ipcMain, app } = electron;
import path from 'path';
import fs from 'fs/promises';
import { BulkSenderService, type SendTask } from './bulkSender';
import { blacklistService } from './blacklistService';

export interface WhatsAppStatus {
  status: 'DISCONNECTED' | 'CONNECTING' | 'READY';
  qr?: string;
  error?: string;
  message?: string;
  user?: {
    id: string;
    phone: string;
    name?: string;
  };
}

export interface NumberValidationResult {
  number: string;
  exists: boolean;
  jid?: string;
}

export class EvolutionService {
  private sock: WASocket | null = null;
  private window: BrowserWindow;
  private bulkSender: BulkSenderService | null = null;
  private currentStatus: WhatsAppStatus = { status: 'CONNECTING', message: 'Iniciando Evolution Engine...' };
  private authDir: string;
  private isStopping = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(window: BrowserWindow) {
    this.window = window;
    this.authDir = path.join(app.getPath('userData'), 'evolution_auth');
    this.initializeIPC();
  }

  private emitStatus(payload: WhatsAppStatus) {
    this.currentStatus = payload;
    if (!this.window.isDestroyed()) {
      this.window.webContents.send('whatsapp-status', payload);
    }
  }

  public async start() {
    this.isStopping = false;
    this.emitStatus({ status: 'CONNECTING', message: 'Cargando credenciales seguras...' });

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion();

      const logger = pino({ level: 'silent' });

      this.sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        browser: ['FCSender Evolution', 'Desktop', '2.1.0'],
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
      });

      this.sock.ev.on('creds.update', saveCreds);

      // Listener de mensajes entrantes para detección de OPT-OUT ("SALIR")
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (msg.key.fromMe || !msg.message) continue;
          const jid = msg.key.remoteJid || '';
          if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

          const text = msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption || '';

          const cleanText = text.trim().toUpperCase();
          // Regex que captura palabras clave de baja
          const optOutMatch = cleanText.match(/\b(SALIR|CANCELAR|UNSUBSCRIBE|BAJA|STOP|NO ENVIAR)\b/i);

          if (optOutMatch) {
            const rawPhone = await this.resolveSenderPhone(msg);
            const keyword = optOutMatch[0].toUpperCase();
            const added = await blacklistService.addToBlacklist(rawPhone, 'opt_out', keyword);

            if (added) {
              console.log(`Evolution: Contacto +${rawPhone} solicitó Opt-Out con "${keyword}". Registrado en Blacklist.`);
              
              if (!this.window.isDestroyed()) {
                this.window.webContents.send('bulk-log', {
                  msg: `🛡️ Contacto +${rawPhone} respondió "${keyword}". Añadido a Lista Negra (Opt-Out).`,
                  type: 'info'
                });
                const updatedList = await blacklistService.getBlacklist();
                this.window.webContents.send('blacklist-updated', updatedList);
              }

              // Respuesta automática de confirmación al JID del remitente
              try {
                await this.sock?.sendMessage(jid, {
                  text: '✅ Has sido dado de baja exitosamente de nuestra lista de comunicados. No recibirás más mensajes.'
                });
              } catch (err) {
                console.warn('No se pudo enviar confirmación de opt-out al contacto:', err);
              }
            }
          }
        }
      });

      this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            console.log('Evolution: Nuevo código QR generado');
            const qrDataUrl = await qrcode.toDataURL(qr);
            this.emitStatus({
              status: 'DISCONNECTED',
              qr: qrDataUrl,
              message: 'Escanea el código QR desde Dispositivos Vinculados en WhatsApp'
            });
          } catch (err) {
            console.error('Error al generar QR DataURL:', err);
          }
        }

        if (connection === 'connecting') {
          this.emitStatus({ status: 'CONNECTING', message: 'Estableciendo túnel WebSocket con WhatsApp...' });
        } else if (connection === 'open') {
          console.log('Evolution: Conexión abierta con éxito');
          this.reconnectAttempts = 0;

          // Resolver número real del remitente/directivo evitando identificadores LID internos
          const selfJid = await this.getSelfJid();
          const cleanPhone = selfJid
            ? selfJid.split('@')[0]
            : (this.sock?.user?.id?.split(':')[0].replace(/\D/g, '') || '');
          const userName = this.sock?.user?.name || (this.sock as any)?.authState?.creds?.me?.name || 'Remitente';

          this.bulkSender = new BulkSenderService(this, this.window);

          this.emitStatus({
            status: 'READY',
            message: 'Conectado y listo para envíos',
            user: {
              id: this.sock?.user?.id || '',
              phone: cleanPhone,
              name: userName
            }
          });
        } else if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !this.isStopping;

          console.log(`Evolution: Conexión cerrada. Status: ${statusCode}, Reintentar: ${shouldReconnect}`);

          if (this.bulkSender) {
            this.bulkSender.stop();
          }

          if (statusCode === DisconnectReason.loggedOut) {
            await this.clearAuth();
            this.emitStatus({
              status: 'DISCONNECTED',
              message: 'Sesión cerrada desde el dispositivo. Por favor vuelve a vincular.'
            });
            this.start();
          } else if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.emitStatus({
              status: 'CONNECTING',
              message: `Reconectando túnel WhatsApp (intento ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
            });
            setTimeout(() => this.start(), 3000);
          } else {
            this.emitStatus({
              status: 'DISCONNECTED',
              message: 'Desconectado. Verifica tu conexión a internet.'
            });
          }
        }
      });
    } catch (error: any) {
      console.error('Error al inicializar Evolution Engine:', error);
      this.emitStatus({
        status: 'DISCONNECTED',
        error: error.message || 'Error al iniciar motor de WhatsApp'
      });
    }
  }

  public async resolveSenderPhone(msg: any): Promise<string> {
    // 1. Verificar si viene el JID de teléfono en remoteJidAlt o participantAlt (WhatsApp multi-device estándar)
    const remoteJidAlt = msg.key?.remoteJidAlt || '';
    if (remoteJidAlt.includes('@s.whatsapp.net')) {
      return remoteJidAlt.split('@')[0].split(':')[0].replace(/\D/g, '');
    }

    const participantAlt = msg.key?.participantAlt || '';
    if (participantAlt.includes('@s.whatsapp.net')) {
      return participantAlt.split('@')[0].split(':')[0].replace(/\D/g, '');
    }

    const remoteJid = msg.key?.remoteJid || '';
    if (remoteJid.includes('@s.whatsapp.net')) {
      return remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    }

    const participant = msg.key?.participant || '';
    if (participant.includes('@s.whatsapp.net')) {
      return participant.split('@')[0].split(':')[0].replace(/\D/g, '');
    }

    // 2. Si es un LID (@lid), resolver el mapeo inverso a número telefónico (PN) usando Baileys Signal Repository
    if (remoteJid.includes('@lid') && this.sock?.signalRepository) {
      try {
        const repo = this.sock.signalRepository as any;
        let pnJid = await repo?.lidMapping?.getPNForLID?.(remoteJid);
        if (!pnJid && repo?.getPNForLID) {
          pnJid = await repo.getPNForLID(remoteJid);
        }

        if (pnJid) {
          const cleanPn = pnJid.split('@')[0].split(':')[0].replace(/\D/g, '');
          if (cleanPn) {
            console.log(`Evolution: Resuelto LID ${remoteJid} -> Teléfono real +${cleanPn}`);
            return cleanPn;
          }
        }
      } catch (err) {
        console.warn('Evolution: No se pudo mapear LID a teléfono mediante signalRepository:', err);
      }
    }

    // 3. Fallback: extraer identificador directo
    return remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
  }

  public async validateNumbers(rawNumbers: string[]): Promise<{
    results: NumberValidationResult[];
    validCount: number;
    invalidCount: number;
  }> {
    if (!this.sock) {
      throw new Error('El motor de WhatsApp no está conectado');
    }

    const uniqueNumbers = Array.from(new Set(rawNumbers.map(n => n.replace(/\D/g, '')).filter(Boolean)));
    const results: NumberValidationResult[] = [];

    const batchSize = 20;
    for (let i = 0; i < uniqueNumbers.length; i += batchSize) {
      const batch = uniqueNumbers.slice(i, i + batchSize);
      try {
        const checks = await this.sock.onWhatsApp(...batch);
        const checkedMap = new Map((checks || []).map(c => [c.jid.split('@')[0], c]));

        for (const num of batch) {
          const match = checkedMap.get(num) || (checks || []).find(c => c.jid.includes(num));
          if (match && match.exists) {
            results.push({ number: num, exists: true, jid: match.jid });
          } else {
            results.push({ number: num, exists: false });
          }
        }
      } catch (err) {
        console.error('Error en lote de validación:', err);
        for (const num of batch) {
          results.push({ number: num, exists: false });
        }
      }
    }

    const validCount = results.filter(r => r.exists).length;
    const invalidCount = results.filter(r => !r.exists).length;

    return { results, validCount, invalidCount };
  }

  public async subscribePresence(jid: string) {
    if (!this.sock) return;
    try {
      if (typeof this.sock.presenceSubscribe === 'function') {
        await this.sock.presenceSubscribe(jid);
      }
    } catch (e) {
      console.warn('Error al suscribir presencia:', e);
    }
  }

  public async sendPresence(jid: string, type: 'available' | 'composing' | 'paused') {
    if (!this.sock) return;
    try {
      if (type === 'available') {
        // Baileys requiere un name en creds.me para no descartar el evento available
        const me = (this.sock.user || (this.sock as any).authState?.creds?.me) as any;
        if (me && !me.name) {
          me.name = 'FCSender';
        }
        await this.sock.sendPresenceUpdate('available');
      } else {
        await this.sock.sendPresenceUpdate(type, jid);
      }
    } catch (e) {
      console.warn('Error al actualizar presencia:', e);
    }
  }

  public async sendTextMessage(jid: string, text: string) {
    if (!this.sock) throw new Error('Cliente no conectado');
    return await this.sock.sendMessage(jid, { text });
  }

  public async sendMediaMessage(jid: string, buffer: Buffer, mimetype: string, caption?: string) {
    if (!this.sock) throw new Error('Cliente no conectado');
    if (mimetype.startsWith('video/')) {
      return await this.sock.sendMessage(jid, {
        video: buffer,
        mimetype: 'video/mp4',
        caption: caption || undefined,
        gifPlayback: false
      });
    } else {
      return await this.sock.sendMessage(jid, {
        image: buffer,
        mimetype,
        caption: caption || undefined,
      });
    }
  }

  public async getSelfJid(): Promise<string | null> {
    if (!this.sock) return null;
    const me = (this.sock.user || (this.sock as any).authState?.creds?.me) as any;
    if (!me) return null;

    // 1. Si viene phoneNumber explícito en el objeto Contact (ej: 593989032887@s.whatsapp.net)
    if (me.phoneNumber) {
      const clean = me.phoneNumber.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (clean) return `${clean}@s.whatsapp.net`;
    }

    // 2. Si el ID ya es un JID telefónico (@s.whatsapp.net)
    const rawId = me.id || '';
    if (rawId.includes('@s.whatsapp.net')) {
      const clean = rawId.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (clean) return `${clean}@s.whatsapp.net`;
    }

    // 3. Si el ID es un LID (@lid), resolver el mapeo inverso con Signal Repository
    if (rawId.includes('@lid') || me.lid) {
      const targetLid = rawId.includes('@lid') ? rawId : me.lid;
      try {
        const repo = this.sock.signalRepository as any;
        let pnJid = await repo?.lidMapping?.getPNForLID?.(targetLid);
        if (!pnJid && repo?.getPNForLID) {
          pnJid = await repo.getPNForLID(targetLid);
        }
        if (pnJid) {
          const cleanPn = pnJid.split('@')[0].split(':')[0].replace(/\D/g, '');
          if (cleanPn) return `${cleanPn}@s.whatsapp.net`;
        }
      } catch (lidErr) {
        console.warn('Error resolviendo self LID a teléfono:', lidErr);
      }
    }

    // 4. Fallback numérico si no es LID
    if (!rawId.includes('@lid')) {
      const fallbackDigits = rawId.split(':')[0].replace(/\D/g, '');
      if (fallbackDigits) return `${fallbackDigits}@s.whatsapp.net`;
    }

    return null;
  }

  public async sendReport(reportMsg: string): Promise<boolean> {
    const selfJid = await this.getSelfJid();
    if (!selfJid || !this.sock) {
      console.warn('No se puede enviar auto-reporte: JID propio no identificado o cuenta en LID sin resolver.');
      return false;
    }
    try {
      await this.sock.sendMessage(selfJid, { text: reportMsg });
      console.log('Evolution: Auto-reporte enviado exitosamente al directivo/remitente:', selfJid);
      return true;
    } catch (e) {
      console.error('Evolution: Error al enviar auto-reporte al directivo/remitente:', e);
      return false;
    }
  }

  private async clearAuth() {
    try {
      await fs.rm(this.authDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Error al limpiar directorio de autenticación:', err);
    }
  }

  public async logout() {
    this.isStopping = true;
    if (this.bulkSender) {
      this.bulkSender.stop();
    }
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (e) {
        console.warn('Error en logout:', e);
      }
      this.sock.end(undefined);
      this.sock = null;
    }
    await this.clearAuth();
    this.emitStatus({ status: 'DISCONNECTED', message: 'Sesión cerrada correctamente' });
    this.start();
  }

  public async stop() {
    this.isStopping = true;
    if (this.bulkSender) {
      this.bulkSender.stop();
    }
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
  }

  private initializeIPC() {
    ipcMain.removeAllListeners('get-whatsapp-status');
    ipcMain.removeAllListeners('start-bulk-send');
    ipcMain.removeAllListeners('stop-bulk-send');
    ipcMain.removeAllListeners('validate-numbers');
    ipcMain.removeAllListeners('logout-whatsapp');
    ipcMain.removeAllListeners('get-blacklist');
    ipcMain.removeAllListeners('add-to-blacklist');
    ipcMain.removeAllListeners('remove-from-blacklist');
    ipcMain.removeAllListeners('clear-blacklist');

    ipcMain.on('get-whatsapp-status', () => {
      if (!this.window.isDestroyed()) {
        this.window.webContents.send('whatsapp-status', this.currentStatus);
      }
    });

    ipcMain.handle('validate-numbers', async (_event, numbers: string[]) => {
      return await this.validateNumbers(numbers);
    });

    ipcMain.handle('logout-whatsapp', async () => {
      await this.logout();
      return true;
    });

    // Gestión de Blacklist IPC
    ipcMain.handle('get-blacklist', async () => {
      return await blacklistService.getBlacklist();
    });

    ipcMain.handle('add-to-blacklist', async (_event, phone: string, reason?: 'opt_out' | 'manual' | 'reported') => {
      const success = await blacklistService.addToBlacklist(phone, reason || 'manual');
      if (success && !this.window.isDestroyed()) {
        this.window.webContents.send('blacklist-updated', await blacklistService.getBlacklist());
      }
      return success;
    });

    ipcMain.handle('remove-from-blacklist', async (_event, phone: string) => {
      const success = await blacklistService.removeFromBlacklist(phone);
      if (success && !this.window.isDestroyed()) {
        this.window.webContents.send('blacklist-updated', await blacklistService.getBlacklist());
      }
      return success;
    });

    ipcMain.handle('clear-blacklist', async () => {
      await blacklistService.clearBlacklist();
      if (!this.window.isDestroyed()) {
        this.window.webContents.send('blacklist-updated', []);
      }
      return true;
    });

    ipcMain.on('start-bulk-send', (_event, tasks: SendTask[], config: {
      batchSize: number;
      restMinutes: number;
      minDelay: number;
      maxDelay: number;
      autoValidate?: boolean;
      includeOptOut?: boolean;
      optOutText?: string;
      videoMutationMode?: 'fast' | 'deep';
    }) => {
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
}
