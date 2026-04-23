import { Client, MessageMedia } from 'whatsapp-web.js';
import type { BrowserWindow } from 'electron';
import sharp from 'sharp';
import fs from 'fs/promises';

export interface SendTask {
  number: string;
  text: string;
  imagePath?: string;
}

export class BulkSenderService {
  private client: Client;
  private window: BrowserWindow;
  private tasks: SendTask[] = [];
  private isSending = false;
  private shouldStop = false;
  private batchSize = 0;
  private restMinutes = 0;
  private minDelay = 30;
  private maxDelay = 120;

  constructor(client: Client, window: BrowserWindow) {
    this.client = client;
    this.window = window;
  }

  public addTasks(newTasks: SendTask[], config?: { batchSize: number, restMinutes: number, minDelay: number, maxDelay: number }) {
    if (config) {
      this.batchSize = config.batchSize || 0;
      this.restMinutes = config.restMinutes || 0;
      this.minDelay = config.minDelay || 30;
      this.maxDelay = config.maxDelay || 120;
    }
    this.tasks.push(...newTasks);
    if (!this.isSending) {
      this.start();
    }
  }

  public stop() {
    this.shouldStop = true;
  }

  // FASE 1: Spintax Parser
  private parseSpintax(text: string): string {
    return text.replace(/\{([^{}]+)\}/g, (_, contents) => {
      const choices = contents.split('|');
      return choices[Math.floor(Math.random() * choices.length)];
    });
  }

  // FASE 1: Píxel Fantasma con Sharp (Alteración indetectable de metadata/ruido)
  private async processImage(imageData: string): Promise<string> {
    let buffer: Buffer;
    if (imageData.startsWith('data:image')) {
      // Es un Base64 Data URL que viene del frontend
      const base64Data = imageData.split(';base64,').pop()!;
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      // Fallback por si es una ruta de archivo local
      buffer = await fs.readFile(imageData);
    }

    const processed = await sharp(buffer)
      .jpeg() // Forzar formato JPEG para mayor compatibilidad con whatsapp-web.js
      // Añade un jitter casi invisible al brillo para alterar el Hash MD5/SHA256 del archivo y evitar filtros Anti-Spam
      .modulate({ brightness: 1 + (Math.random() * 0.01) })
      .toBuffer();
    return processed.toString('base64');
  }

  private async start() {
    this.isSending = true;
    this.shouldStop = false;
    let messagesSentInBatch = 0;
    let successCount = 0;
    let errorCount = 0;
    const startTime = Date.now();

    while (this.tasks.length > 0) {
      if (this.shouldStop) {
        this.window.webContents.send('bulk-log', { msg: 'Proceso detenido por el usuario', type: 'info' });
        break;
      }

      // FASE 4: Descanso por lotes (Cuenta regresiva visible en el frontend)
      if (this.batchSize > 0 && messagesSentInBatch >= this.batchSize) {
        const sleepMs = this.restMinutes * 60 * 1000;
        this.window.webContents.send('bulk-log', { msg: `Lote completado. Descansando ${this.restMinutes} minutos para proteger la cuenta.`, type: 'info' });
        this.window.webContents.send('bulk-delay', { delay: sleepMs });

        const iterations = Math.floor(sleepMs / 1000);
        for (let i = 0; i < iterations; i++) {
            if (this.shouldStop) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (this.shouldStop) continue; // Si se canceló durante el descanso, el break de arriba lo capturará en el siguiente ciclo
        messagesSentInBatch = 0;
      }

      const task = this.tasks.shift()!;
      this.window.webContents.send('bulk-update', { queued: this.tasks.length, isSending: true });

      try {
        const formattedNumber = `${task.number}@c.us`;
        const message = this.parseSpintax(task.text);

        // FASE 1: Delay aleatorio basado en configuración de UI
        const minMs = this.minDelay * 1000;
        const maxMs = this.maxDelay * 1000;
        const delayMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        this.window.webContents.send('bulk-delay', { delay: delayMs });

        // FASE 1: Simulación Humana de Escritura (Composing proporcional)
        // Calcula ~100ms por carácter, máximo 25 segundos + jitter de 2s para evitar patrones exactos.
        const typingTimeMs = Math.min(message.length * 100, 25000) + Math.floor(Math.random() * 2000);
        const idleTimeMs = Math.max(delayMs - typingTimeMs, 0);

        // 1. Ponerse en línea (Presence)
        await this.client.sendPresenceAvailable();
        const chat = await this.client.getChatById(formattedNumber);

        // 2. Espera inactiva antes de escribir (simula leer o estar en otro chat)
        if (idleTimeMs > 0) {
          await new Promise(resolve => setTimeout(resolve, idleTimeMs));
        }

        // 3. Escribir el mensaje (estado composing)
        await chat.sendStateTyping();
        await new Promise(resolve => setTimeout(resolve, typingTimeMs));

        await chat.clearState();

        // Envío
        if (task.imagePath) {
          const base64Image = await this.processImage(task.imagePath);
          const media = new MessageMedia('image/jpeg', base64Image, 'image.jpg');
          await this.client.sendMessage(formattedNumber, media, { caption: message });
        } else {
          await this.client.sendMessage(formattedNumber, message);
        }

        messagesSentInBatch++;
        successCount++;
        this.window.webContents.send('bulk-progress', { status: 'success', number: task.number });
      } catch (error: any) {
        errorCount++;
        this.window.webContents.send('bulk-progress', { status: 'error', number: task.number, error: error.message });
      }
    }

    const endTime = Date.now();
    const elapsedMs = endTime - startTime;
    const elapsedMinutes = Math.floor(elapsedMs / 60000);
    const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
    const timeStr = elapsedMinutes > 0 ? `${elapsedMinutes}m ${elapsedSeconds}s` : `${elapsedSeconds}s`;

    // Auto-Reporte al propio número
    if (this.client?.info?.wid?._serialized) {
        const reportMsg = `📊 *Reporte de Envío FCSender*\n\n✅ Enviados: ${successCount}\n❌ Fallidos: ${errorCount}\n⏱️ Tiempo total: ${timeStr}`;
        try {
            await this.client.sendMessage(this.client.info.wid._serialized, reportMsg);
        } catch (e) {
            console.error("Error al enviar el auto-reporte", e);
        }
    }

    this.isSending = false;
    this.window.webContents.send('bulk-update', { queued: 0, isSending: false });
    this.window.webContents.send('bulk-log', { msg: 'Ronda de envíos finalizada', type: 'success' });
    this.window.webContents.send('bulk-finish', { successCount, errorCount, timeStr });
  }
}