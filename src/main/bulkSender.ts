import type { BrowserWindow } from 'electron';
import sharp from 'sharp';
import fs from 'fs/promises';
import type { EvolutionService } from './evolutionService';
import { blacklistService } from './blacklistService';

export interface SendTask {
  number: string;
  text: string;
  imagePath?: string;
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
    }
    this.tasks.push(...newTasks);
    if (!this.isSending) {
      this.start();
    }
  }

  public stop() {
    this.shouldStop = true;
  }

  // Spintax Parser recursivo/aleatorio
  private parseSpintax(text: string): string {
    return text.replace(/\{([^{}]+)\}/g, (_, contents) => {
      const choices = contents.split('|');
      return choices[Math.floor(Math.random() * choices.length)];
    });
  }

  // Píxel Fantasma 2.0: Mutación indetectable de hash criptográfico (MD5/SHA256) por cada destinatario
  private async processImage(imageData: string): Promise<Buffer> {
    let buffer: Buffer;
    if (imageData.startsWith('data:image')) {
      const base64Data = imageData.split(';base64,').pop()!;
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      buffer = await fs.readFile(imageData);
    }

    const brightnessMod = 1 + (Math.random() * 0.006 + 0.001);
    const saturationMod = 1 + (Math.random() * 0.004 - 0.002);

    const processedBuffer = await sharp(buffer)
      .withMetadata({ exif: {} })
      .modulate({
        brightness: brightnessMod,
        saturation: saturationMod
      })
      .jpeg({
        quality: Math.floor(Math.random() * 3) + 90,
        chromaSubsampling: '4:4:4'
      })
      .toBuffer();

    return processedBuffer;
  }

  private async start() {
    this.isSending = true;
    this.shouldStop = false;
    let messagesSentInBatch = 0;
    let successCount = 0;
    let errorCount = 0;
    let filteredCount = 0;
    let blacklistedCount = 0;
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
        const typingTimeMs = Math.min(Math.max(message.length * 70, 1500), 18000) + Math.floor(Math.random() * 1500);
        const idleTimeMs = Math.max(delayMs - typingTimeMs, 0);

        // 1. Estado en línea general
        await this.evolution.sendPresence(jid, 'available');

        // 2. Tiempo de lectura / inactividad previo
        if (idleTimeMs > 0) {
          await new Promise(resolve => setTimeout(resolve, idleTimeMs));
        }

        if (this.shouldStop) {
          this.tasks.unshift(task);
          break;
        }

        // 3. Simulación de "Escribiendo..."
        await this.evolution.sendPresence(jid, 'composing');
        await new Promise(resolve => setTimeout(resolve, typingTimeMs));
        await this.evolution.sendPresence(jid, 'paused');

        // 4. Envío de mensaje
        if (task.imagePath) {
          const imageBuffer = await this.processImage(task.imagePath);
          await this.evolution.sendMediaMessage(jid, imageBuffer, 'image/jpeg', message);
        } else {
          await this.evolution.sendTextMessage(jid, message);
        }

        messagesSentInBatch++;
        successCount++;
        this.window.webContents.send('bulk-progress', { status: 'success', number: task.number });
      } catch (error: any) {
        errorCount++;
        const errorMsg = error?.message || 'Error desconocido al enviar';
        this.window.webContents.send('bulk-progress', {
          status: 'error',
          number: task.number,
          error: errorMsg
        });
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