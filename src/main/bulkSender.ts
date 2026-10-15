import type { BrowserWindow } from 'electron';
import type { EvolutionService } from './evolutionService';
import { blacklistService } from './blacklistService';
import { MediaProcessor, type VideoMutationMode } from './mediaProcessor';

export interface SendTask {
  number: string;
  text: string;
  imagePath?: string;
  mediaPath?: string;
  mediaType?: 'image' | 'video';
}

export class BulkSenderService {
  private evolution: EvolutionService;
  private window: BrowserWindow;
  private tasks: SendTask[] = [];
  private isSending = false;
  private shouldStop = false;
  private batchSize = 0;
  private restMinutes = 0;
  private minDelay = 30;
  private maxDelay = 120;
  private autoValidate = true;
  private includeOptOut = true;
  private optOutText = '\n\n_Si quieres dejar de recibir promociones, responde "SALIR"_';
  private videoMutationMode: VideoMutationMode = 'fast';

  constructor(evolution: EvolutionService, window: BrowserWindow) {
    this.evolution = evolution;
    this.window = window;
  }

  public addTasks(
    newTasks: SendTask[],
    config?: {
      batchSize: number;
      restMinutes: number;
      minDelay: number;
      maxDelay: number;
      autoValidate?: boolean;
      includeOptOut?: boolean;
      optOutText?: string;
      videoMutationMode?: VideoMutationMode;
    }
  ) {
    if (config) {
      this.batchSize = config.batchSize || 0;
      this.restMinutes = config.restMinutes || 0;
      this.minDelay = config.minDelay || 30;
      this.maxDelay = config.maxDelay || 120;
      this.autoValidate = config.autoValidate !== undefined ? config.autoValidate : true;
      this.includeOptOut = config.includeOptOut !== undefined ? config.includeOptOut : true;
      if (config.optOutText) this.optOutText = config.optOutText;
      if (config.videoMutationMode) this.videoMutationMode = config.videoMutationMode;
    }
    this.tasks.push(...newTasks);
    if (!this.isSending) {
      this.start();
    }
  }

  public stop() {
    this.shouldStop = true;
  }

  // Spintax Parser recursivo, dinámico y tolerante a espacios/saltos de línea
  public parseSpintax(text: string): string {
    let result = text;
    const spintaxRegex = /\{([^{}]+)\}/g;
    let iterations = 0;
    while (spintaxRegex.test(result) && iterations < 20) {
      result = result.replace(spintaxRegex, (_, contents) => {
        const choices = contents.split('|');
        const picked = choices[Math.floor(Math.random() * choices.length)];
        return picked.trim();
      });
      iterations++;
    }
    return result;
  }

  private async start() {
    this.isSending = true;
    this.shouldStop = false;
    let messagesSentInBatch = 0;
    let successCount = 0;
    let errorCount = 0;
    let filteredCount = 0;
    let blacklistedCount = 0;
    let consecutiveErrors = 0;
    const initialTotal = this.tasks.length;
    const startTime = Date.now();

    this.window.webContents.send('bulk-log', {
      msg: `Iniciando campaña con ${initialTotal} contactos mediante Evolution Engine...`,
      type: 'info'
    });

    // 1. FILTRO DE LISTA NEGRA (OPT-OUT)
    const remainingTasks: SendTask[] = [];
    for (const t of this.tasks) {
      const isBlocked = await blacklistService.isBlacklisted(t.number);
      if (isBlocked) {
        blacklistedCount++;
        errorCount++;
        this.window.webContents.send('bulk-progress', {
          status: 'error',
          number: t.number,
          error: 'Omitido automáticamente (En Lista Negra / Opt-Out previo)'
        });
      } else {
        remainingTasks.push(t);
      }
    }
    this.tasks = remainingTasks;

    if (blacklistedCount > 0) {
      this.window.webContents.send('bulk-log', {
        msg: `🛡️ Lista Negra: Se omitieron ${blacklistedCount} contactos que solicitaron no recibir más mensajes (Opt-Out).`,
        type: 'info'
      });
    }

    // 2. VALIDACIÓN PREVENTIVA DE EXISTENCIA EN WHATSAPP
    if (this.autoValidate && this.tasks.length > 0) {
      this.window.webContents.send('bulk-log', {
        msg: '🛡️ Verificando existencia en WhatsApp para proteger reputación...',
        type: 'info'
      });
      try {
        const validation = await this.evolution.validateNumbers(this.tasks.map(t => t.number));
        const validMap = new Map(validation.results.map(r => [r.number, r.exists]));
        const currentCount = this.tasks.length;

        this.tasks = this.tasks.filter(t => {
          const clean = t.number.replace(/\D/g, '');
          const exists = validMap.get(clean);
          if (exists === false) {
            filteredCount++;
            errorCount++;
            this.window.webContents.send('bulk-progress', {
              status: 'error',
              number: t.number,
              error: 'No registrado en WhatsApp (Filtro preventivo)'
            });
            return false;
          }
          return true;
        });

        if (filteredCount > 0) {
          this.window.webContents.send('bulk-log', {
            msg: `Filtro preventivo: ${filteredCount} de ${currentCount} números no tienen WhatsApp y fueron excluidos.`,
            type: 'info'
          });
        }
      } catch (valErr: any) {
        console.warn('No se pudo completar la auto-validación previa:', valErr);
      }
    }

    // Preparación y normalización de video master si la campaña incluye video
    let normalizedVideoMaster: string | null = null;
    const sampleTask = this.tasks.find(t => t.mediaPath || t.imagePath);
    const mediaSource = sampleTask?.mediaPath || sampleTask?.imagePath;
    if (mediaSource && MediaProcessor.isVideo(mediaSource)) {
      this.window.webContents.send('bulk-log', {
        msg: 'Optimizando video master (+faststart / H.264 para WhatsApp)...',
        type: 'info'
      });
      try {
        normalizedVideoMaster = await MediaProcessor.normalizeVideoMaster(mediaSource);
        this.window.webContents.send('bulk-log', {
          msg: `Video master optimizado. Motor Vector Fantasma activo (Modo: ${this.videoMutationMode === 'deep' ? 'Profundo' : 'Criptográfico Rápido'}).`,
          type: 'info'
        });
      } catch (vErr: any) {
        console.warn('Advertencia al normalizar video master, usando original:', vErr);
        normalizedVideoMaster = mediaSource;
      }
    }

    while (this.tasks.length > 0) {
      if (this.shouldStop) {
        this.window.webContents.send('bulk-log', { msg: 'Campaña detenida por el operador', type: 'info' });
        break;
      }

      // Descanso por lotes
      if (this.batchSize > 0 && messagesSentInBatch >= this.batchSize) {
        const sleepMs = this.restMinutes * 60 * 1000;
        this.window.webContents.send('bulk-log', {
          msg: `Lote de ${this.batchSize} completado. Pausa de seguridad de ${this.restMinutes} min para proteger reputación.`,
          type: 'info'
        });
        this.window.webContents.send('bulk-delay', { delay: sleepMs });

        const iterations = Math.floor(sleepMs / 1000);
        for (let i = 0; i < iterations; i++) {
          if (this.shouldStop) break;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (this.shouldStop) continue;
        messagesSentInBatch = 0;
      }

      const task = this.tasks.shift()!;
      this.window.webContents.send('bulk-update', { queued: this.tasks.length, isSending: true });

      const cleanNum = task.number.replace(/\D/g, '');
      const jid = `${cleanNum}@s.whatsapp.net`;

      try {
        let message = this.parseSpintax(task.text);

        // Añadir footer de Opt-Out si está configurado
        if (this.includeOptOut && this.optOutText) {
          message += this.optOutText;
        }

        // Delay aleatorio entre mensajes
        const minMs = this.minDelay * 1000;
        const maxMs = this.maxDelay * 1000;
        const delayMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        this.window.webContents.send('bulk-delay', { delay: delayMs });

        // Simulación Humana de Escritura y Presencia
        const typingTimeMs = Math.min(Math.max(message.length * 65, 2000), 16000) + Math.floor(Math.random() * 1200);
        const idleTimeMs = Math.max(delayMs - typingTimeMs, 0);

        // 1. Suscribir presencia al chat para que WhatsApp encamine los estados al dispositivo receptor
        await this.evolution.subscribePresence(jid);
        await this.evolution.sendPresence(jid, 'available');

        // 2. Tiempo de lectura / inactividad previo (pausa humana natural)
        if (idleTimeMs > 0) {
          await new Promise(resolve => setTimeout(resolve, idleTimeMs));
        }

        if (this.shouldStop) {
          this.tasks.unshift(task);
          break;
        }

        // 3. Simulación Humana de "Escribiendo..." sostenida con pulsos periódicos
        // WhatsApp expira el estado 'composing' a los 5 segundos, por lo que enviamos un pulso cada 4s
        const pulseInterval = 4000;
        let typingElapsed = 0;
        while (typingElapsed < typingTimeMs) {
          if (this.shouldStop) break;
          await this.evolution.sendPresence(jid, 'composing');
          const sleepTime = Math.min(pulseInterval, typingTimeMs - typingElapsed);
          await new Promise(resolve => setTimeout(resolve, sleepTime));
          typingElapsed += sleepTime;
        }

        if (this.shouldStop) {
          this.tasks.unshift(task);
          break;
        }

        // 4. Envío de mensaje (WhatsApp finaliza el estado 'composing' automáticamente al recibir el payload)
        const media = task.mediaPath || task.imagePath;
        if (media) {
          if (MediaProcessor.isVideo(media)) {
            const videoSrc = normalizedVideoMaster || media;
            const videoBuffer = await MediaProcessor.mutateVideo(videoSrc, this.videoMutationMode);
            await this.evolution.sendMediaMessage(jid, videoBuffer, 'video/mp4', message);
          } else {
            const imageBuffer = await MediaProcessor.processImage(media);
            await this.evolution.sendMediaMessage(jid, imageBuffer, 'image/jpeg', message);
          }
        } else {
          await this.evolution.sendTextMessage(jid, message);
        }

        consecutiveErrors = 0;
        messagesSentInBatch++;
        successCount++;
        this.window.webContents.send('bulk-progress', { status: 'success', number: task.number });
      } catch (error: any) {
        errorCount++;
        consecutiveErrors++;
        const errorMsg = error?.message || 'Error desconocido al enviar';
        this.window.webContents.send('bulk-progress', {
          status: 'error',
          number: task.number,
          error: errorMsg
        });

        // Mecánica Anti-Flageo: Si ocurren 3 o más errores consecutivos (posible rate-limit o throttle),
        // activar enfriamiento automático de 45 segundos para proteger la reputación de la cuenta.
        if (consecutiveErrors >= 3) {
          const cooldownSec = 45;
          this.window.webContents.send('bulk-log', {
            msg: `⚠️ Protección Anti-Flageo activada: ${consecutiveErrors} fallos consecutivos. Enfriando línea por ${cooldownSec}s para proteger la cuenta...`,
            type: 'error'
          });
          this.window.webContents.send('bulk-delay', { delay: cooldownSec * 1000 });
          for (let c = 0; c < cooldownSec; c++) {
            if (this.shouldStop) break;
            await new Promise(res => setTimeout(res, 1000));
          }
          consecutiveErrors = 0;
        }
      }
    }

    const endTime = Date.now();
    const elapsedMs = endTime - startTime;
    const elapsedMinutes = Math.floor(elapsedMs / 60000);
    const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
    const timeStr = elapsedMinutes > 0 ? `${elapsedMinutes}m ${elapsedSeconds}s` : `${elapsedSeconds}s`;

    const totalProcessed = successCount + errorCount;
    const successRate = totalProcessed > 0 ? Math.round((successCount / totalProcessed) * 100) : 0;
    const dateStr = new Date().toLocaleString();

    // Auto-Reporte Ejecutivo
    const reportMsg = `📊 *Reporte de Campaña - FCSender*\n` +
      `🏢 *Distribución Interna de Comunicaciones*\n\n` +
      `📅 *Fecha:* ${dateStr}\n` +
      `⏱️ *Tiempo Total:* ${timeStr}\n\n` +
      `📈 *Resultados del Envío:*\n` +
      `✅ *Entregados con éxito:* ${successCount}\n` +
      `❌ *Fallidos / No registrados:* ${errorCount}\n` +
      `🛡️ *Omitidos por Lista Negra (Opt-Out):* ${blacklistedCount}\n` +
      `📋 *Total procesados:* ${totalProcessed}\n` +
      `🎯 *Tasa de efectividad:* ${successRate}%\n\n` +
      `🛡️ *Mecanismos de Protección:*\n` +
      `• Píxel Fantasma 2.0 (Hash Único Anti-Spam)\n` +
      `• Sistema de Opt-Out & Lista Negra Activa\n` +
      `• Simulación de Escritura y Presencia Humana\n` +
      `• Motor Evolution WebSocket (0 Puppeteer)`;

    await this.evolution.sendReport(reportMsg);

    this.isSending = false;
    this.window.webContents.send('bulk-update', { queued: 0, isSending: false });
    this.window.webContents.send('bulk-log', {
      msg: `Campaña finalizada. Reporte enviado a tu WhatsApp. (${successCount} enviados, ${errorCount} fallidos, ${blacklistedCount} en lista negra)`,
      type: 'success'
    });
    this.window.webContents.send('bulk-finish', {
      successCount,
      errorCount,
      filteredCount,
      blacklistedCount,
      timeStr,
      successRate
    });
  }
}