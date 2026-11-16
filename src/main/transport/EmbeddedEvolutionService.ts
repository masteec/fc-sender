import fs from 'fs/promises';
import qrcode from 'qrcode';
import pino from 'pino';
import { interruptibleSleep } from '../services/delaysEngine';
import type { ITransportService, RegistrationCheckResult, SendResult } from './ITransportService';

export interface EvolutionConnectionPayload {
  status: 'DISCONNECTED' | 'CONNECTING' | 'READY';
  qr?: string;
  phone?: string;
  name?: string;
  error?: string;
  message?: string;
}

type BaileysModule = typeof import('@whiskeysockets/baileys');
type WASocketType = ReturnType<BaileysModule['default']>;

export class EmbeddedEvolutionService implements ITransportService {
  private authDir: string;
  private sock: WASocketType | null = null;
  private ready = false;
  private stopped = false;
  private starting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private onStatus: (payload: EvolutionConnectionPayload) => void;
  private onIncomingText?: (senderDigits: string, text: string) => void;

  constructor(
    authDir: string,
    onStatus: (payload: EvolutionConnectionPayload) => void,
    onIncomingText?: (senderDigits: string, text: string) => void
  ) {
    this.authDir = authDir;
    this.onStatus = onStatus;
    this.onIncomingText = onIncomingText;
  }

  public isReady(): boolean {
    return this.ready && Boolean(this.sock?.user?.id);
  }

  public getConnectedPhone(): string | null {
    const rawId = this.sock?.user?.id;
    if (!rawId) return null;
    const userPart = rawId.split('@')[0]?.split(':')[0] || '';
    const digits = userPart.replace(/\D/g, '');
    return digits || null;
  }

  private getOwnJid(): string | null {
    const digits = this.getConnectedPhone();
    return digits ? `${digits}@s.whatsapp.net` : null;
  }

  private toJid(recipient: string): string {
    const clean = (recipient || '').replace(/\D/g, '');
    return `${clean}@s.whatsapp.net`;
  }

  public async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.stopped = false;
    this.ready = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      this.onStatus({ status: 'CONNECTING', message: 'Iniciando motor Evolution...' });
      await fs.mkdir(this.authDir, { recursive: true });

      const baileys = await import('@whiskeysockets/baileys');
      const makeWASocket = baileys.default || baileys.makeWASocket;
      const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = baileys;

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      let version: [number, number, number] | undefined;
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;
      } catch {
        version = undefined;
      }

      const logger = pino({ level: 'silent' });

      const sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: Browsers.windows('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false
      });

      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.ready = false;
          try {
            const qrDataUrl = await qrcode.toDataURL(qr, { width: 280, margin: 1 });
            this.onStatus({
              status: 'DISCONNECTED',
              qr: qrDataUrl,
              message: 'Escanea el código QR desde tu WhatsApp'
            });
          } catch {
            this.onStatus({ status: 'DISCONNECTED', error: 'No se pudo generar el código QR' });
          }
        }

        if (connection === 'connecting') {
          this.ready = false;
          this.onStatus({ status: 'CONNECTING', message: 'Conectando con WhatsApp...' });
        }

        if (connection === 'open') {
          this.ready = true;
          const phone = this.getConnectedPhone();
          const name = sock.user?.name || '';
          this.onStatus({
            status: 'READY',
            phone: phone || undefined,
            name: name || undefined,
            message: phone ? `Conectado · +${phone}` : 'Sesión activa'
          });
        }

        if (connection === 'close') {
          this.ready = false;
          const errObj = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
          const statusCode = errObj?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          if (this.stopped) {
            this.onStatus({ status: 'DISCONNECTED', message: 'Motor detenido' });
            return;
          }

          if (isLoggedOut) {
            this.onStatus({ status: 'CONNECTING', message: 'Sesión cerrada. Generando nuevo QR...' });
            await fs.rm(this.authDir, { recursive: true, force: true }).catch(() => {});
            this.sock = null;
            this.reconnectTimer = setTimeout(() => {
              void this.start();
            }, 1000);
          } else {
            this.onStatus({ status: 'CONNECTING', message: 'Reconectando sesión de WhatsApp...' });
            this.sock = null;
            this.reconnectTimer = setTimeout(() => {
              void this.start();
            }, 3000);
          }
        }
      });

      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify' || !this.onIncomingText) return;
        for (const msg of messages) {
          if (msg.key?.fromMe) continue;
          const remote = msg.key?.remoteJid || '';
          if (!remote || remote.endsWith('@g.us') || remote === 'status@broadcast') continue;

          const senderDigits = remote.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') || '';
          const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.buttonsResponseMessage?.selectedDisplayText ||
            '';
          if (senderDigits && text) {
            this.onIncomingText(senderDigits, text);
          }
        }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar Evolution';
      this.onStatus({ status: 'DISCONNECTED', error: msg, message: `Error: ${msg}` });
    } finally {
      this.starting = false;
    }
  }

  public async logout(): Promise<void> {
    this.ready = false;
    try {
      if (this.sock) {
        await this.sock.logout().catch(() => {});
        this.sock.end(undefined);
      }
    } finally {
      this.sock = null;
      await fs.rm(this.authDir, { recursive: true, force: true }).catch(() => {});
      if (!this.stopped) {
        await this.start();
      }
    }
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // ignore close error
      }
      this.sock = null;
    }
  }

  public async isRegisteredUser(recipient: string, signal?: AbortSignal): Promise<RegistrationCheckResult> {
    if (signal?.aborted) return { exists: false, verified: false };
    const clean = (recipient || '').replace(/\D/g, '');
    if (!clean || clean.length < 7) return { exists: false, verified: true };
    if (!this.sock || !this.ready) return { exists: false, verified: false };

    try {
      const results = await this.sock.onWhatsApp(clean);
      const first = Array.isArray(results) ? results[0] : undefined;
      if (first) {
        return {
          exists: Boolean(first.exists),
          verified: true,
          jid: first.jid
        };
      }
      return { exists: false, verified: true };
    } catch {
      return { exists: false, verified: false };
    }
  }

  private async simulateHumanTyping(jid: string, textLength: number, signal?: AbortSignal): Promise<boolean> {
    if (!this.sock) return false;
    try {
      await this.sock.presenceSubscribe(jid).catch(() => {});
      await this.sock.sendPresenceUpdate('available', jid).catch(() => {});

      const charMs = 95 + Math.floor(Math.random() * 45);
      const typingMs = Math.max(2000, Math.min(textLength * charMs, 20000)) + Math.floor(Math.random() * 1500);
      const chunkMs = 9000;
      let remaining = typingMs;

      while (remaining > 0) {
        if (signal?.aborted) {
          await this.sock.sendPresenceUpdate('paused', jid).catch(() => {});
          return false;
        }
        await this.sock.sendPresenceUpdate('composing', jid).catch(() => {});
        const slice = Math.min(chunkMs, remaining);
        const ok = await interruptibleSleep(slice, signal);
        if (!ok) {
          await this.sock.sendPresenceUpdate('paused', jid).catch(() => {});
          return false;
        }
        remaining -= slice;
      }

      await this.sock.sendPresenceUpdate('paused', jid).catch(() => {});
      return true;
    } catch {
      return !signal?.aborted;
    }
  }

  public async sendTextMessage(
    recipient: string,
    text: string,
    signal?: AbortSignal,
    resolvedJid?: string
  ): Promise<SendResult> {
    const start = Date.now();
    if (!this.sock || !this.ready) {
      return { success: false, error: 'Sesión de WhatsApp no conectada', statusCode: 401, latencyMs: 0 };
    }

    const jid = resolvedJid || this.toJid(recipient);
    const typingOk = await this.simulateHumanTyping(jid, text.length, signal);
    if (!typingOk) {
      return { success: false, error: 'Envío cancelado', latencyMs: Date.now() - start };
    }

    try {
      const sent = await this.sock.sendMessage(jid, { text });
      return {
        success: true,
        messageId: sent?.key?.id || `msg_${Date.now()}`,
        latencyMs: Date.now() - start
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error enviando mensaje';
      return {
        success: false,
        error: msg,
        latencyMs: Date.now() - start
      };
    }
  }

  public async sendMediaBuffer(
    recipient: string,
    buffer: Buffer,
    filename: string,
    caption?: string,
    signal?: AbortSignal,
    mediaType: 'image' | 'video' = 'image',
    mimeType = 'image/jpeg',
    resolvedJid?: string
  ): Promise<SendResult> {
    const start = Date.now();
    if (!this.sock || !this.ready) {
      return { success: false, error: 'Sesión de WhatsApp no conectada', statusCode: 401, latencyMs: 0 };
    }

    const jid = resolvedJid || this.toJid(recipient);
    const typingOk = await this.simulateHumanTyping(jid, (caption || '').length + 20, signal);
    if (!typingOk) {
      return { success: false, error: 'Envío cancelado', latencyMs: Date.now() - start };
    }

    try {
      const content =
        mediaType === 'video'
          ? { video: buffer, caption: caption || '', mimetype: mimeType, fileName: filename }
          : { image: buffer, caption: caption || '', mimetype: mimeType, fileName: filename };

      const sent = await this.sock.sendMessage(jid, content);
      return {
        success: true,
        messageId: sent?.key?.id || `med_${Date.now()}`,
        latencyMs: Date.now() - start
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error enviando archivo multimedia';
      return {
        success: false,
        error: msg,
        latencyMs: Date.now() - start
      };
    }
  }

  public async sendSelfReport(text: string): Promise<boolean> {
    const ownJid = this.getOwnJid();
    if (!this.sock || !this.ready || !ownJid) return false;
    try {
      await this.sock.sendMessage(ownJid, { text });
      return true;
    } catch {
      return false;
    }
  }
}
