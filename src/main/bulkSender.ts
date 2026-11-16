import type { BrowserWindow } from 'electron';
import appElectron from 'electron';
import fs from 'fs/promises';
import path from 'path';

import { ImageVariantProcessor, type ProcessedMedia } from './services/imageProcessor';
import { HumanDelaysEngine, interruptibleSleep } from './services/delaysEngine';
import { SlidingRateLimiter } from './services/rateLimiter';
import { CampaignQueueStore, type ContactRecord, type SavedCampaignMedia } from './services/queueStore';
import { SpintaxEnhancer } from './services/spintaxEnhancer';
import { CSVLogger } from './services/csvLogger';
import { ExcelReportGenerator, type CampaignExcelRow } from './services/excelReportGenerator';
import { ArrayUtils } from './services/arrayUtils';
import { GracefulShutdownHandler } from './services/shutdownHandler';
import { BlacklistManager } from './services/blacklistManager';
import type { AppSettings } from './services/settingsManager';
import type { ITransportService, SendResult } from './transport/ITransportService';

export interface SendTask {
  number: string;
  text: string;
}

export interface BulkSenderConfig {
  batchSize?: number;
  restMinutes?: number;
  minDelay?: number;
  maxDelay?: number;
  maxPerMinute?: number;
  includeOptOutFooter?: boolean;
  optOutFooterText?: string;
  checkRegisteredBeforeSend?: boolean;
  circuitBreakerThreshold?: number;
  sharedImageDataUrl?: string;
  sharedMediaPath?: string;
  sharedMediaType?: 'image' | 'video';
  sharedMediaExt?: string;
  storageDir?: string;
}

export class BulkSenderService {
  private window: BrowserWindow;
  private transport: ITransportService;
  private blacklist: BlacklistManager;
  private store: CampaignQueueStore;
  private isSending = false;
  private isInitializing = false;
  private abortController: AbortController | null = null;
  private config: BulkSenderConfig = {
    batchSize: 25,
    restMinutes: 5,
    minDelay: 30,
    maxDelay: 120,
    maxPerMinute: 3,
    includeOptOutFooter: true,
    optOutFooterText: 'Para no recibir más avisos de este tipo, responde STOP o BAJA.',
    checkRegisteredBeforeSend: true,
    circuitBreakerThreshold: 5
  };

  private imageProcessor = new ImageVariantProcessor();
  private delaysEngine = new HumanDelaysEngine();
  private rateLimiter = new SlidingRateLimiter(3);
  private spintaxEnhancer = new SpintaxEnhancer();
  private shutdownHandler: GracefulShutdownHandler;

  constructor(
    window: BrowserWindow,
    transport: ITransportService,
    blacklist: BlacklistManager,
    store: CampaignQueueStore
  ) {
    this.window = window;
    this.transport = transport;
    this.blacklist = blacklist;
    this.store = store;

    this.shutdownHandler = new GracefulShutdownHandler(async () => {
      this.stop();
      this.logToWindow('Proceso interrumpido por señal del sistema. Estado guardado correctamente.', 'info');
    });
  }

  public isActive(): boolean {
    return this.isSending || this.isInitializing;
  }

  public dispose() {
    this.stop();
    this.shutdownHandler.dispose();
  }

  private mergeSafetyIntoConfig(appSettings?: AppSettings, config?: BulkSenderConfig) {
    const safety = appSettings?.safety;
    this.config = {
      ...this.config,
      ...(safety
        ? {
            maxPerMinute: safety.maxPerMinute,
            batchSize: safety.batchSize,
            restMinutes: safety.restMinutes,
            includeOptOutFooter: safety.includeOptOutFooter,
            optOutFooterText: safety.optOutFooterText,
            checkRegisteredBeforeSend: safety.checkRegisteredBeforeSend,
            circuitBreakerThreshold: safety.circuitBreakerThreshold
          }
        : {}),
      ...(config || {})
    };
    this.rateLimiter.setMaxPerMinute(this.config.maxPerMinute || 3);
  }

  private async resolveCampaignMedia(): Promise<SavedCampaignMedia | null> {
    const mediaType: 'image' | 'video' = this.config.sharedMediaType === 'video' ? 'video' : 'image';

    if (this.config.sharedMediaPath) {
      try {
        const buffer = await fs.readFile(this.config.sharedMediaPath);
        const extFromPath = path.extname(this.config.sharedMediaPath).replace('.', '').toLowerCase();
        const ext = this.config.sharedMediaExt || extFromPath || (mediaType === 'video' ? 'mp4' : 'jpg');
        return { buffer, mediaType, ext };
      } catch {
        this.logToWindow('No se pudo leer el archivo multimedia desde disco; se enviará solo texto.', 'warn');
        return null;
      }
    }

    if (this.config.sharedImageDataUrl && this.config.sharedImageDataUrl.startsWith('data:')) {
      const header = this.config.sharedImageDataUrl.split(';base64,')[0] || '';
      const base64Data = this.config.sharedImageDataUrl.split(';base64,').pop();
      if (!base64Data) return null;
      const detectedVideo = header.includes('video/');
      const finalType: 'image' | 'video' = detectedVideo ? 'video' : mediaType;
      const ext = this.config.sharedMediaExt || (finalType === 'video' ? 'mp4' : 'jpg');
      return { buffer: Buffer.from(base64Data, 'base64'), mediaType: finalType, ext };
    }

    return null;
  }

  private deduplicateTasks(tasks: SendTask[]): SendTask[] {
    const seen = new Set<string>();
    const unique: SendTask[] = [];
    for (const t of tasks) {
      const clean = (t.number || '').replace(/\D/g, '');
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      unique.push({ ...t, number: clean });
    }
    return unique;
  }

  public async addTasks(newTasks: SendTask[], config?: BulkSenderConfig, appSettings?: AppSettings) {
    if (this.isActive()) {
      this.logToWindow('Ya hay una campaña en ejecución. Detén la actual antes de iniciar otra.', 'warn');
      return;
    }

    this.isInitializing = true;
    try {
      this.mergeSafetyIntoConfig(appSettings, config);

      const userDataDir = appElectron.app ? appElectron.app.getPath('userData') : process.cwd();
      const storageDir = this.config.storageDir || path.join(userDataDir, 'sender_storage');

      await this.store.init();
      await this.blacklist.init();

      const uniqueTasks = this.deduplicateTasks(newTasks);
      const duplicatesRemoved = newTasks.length - uniqueTasks.length;
      if (duplicatesRemoved > 0) {
        this.logToWindow(`Se depuraron ${duplicatesRemoved} número(s) duplicados o inválidos antes de iniciar.`, 'info');
      }

      const logger = new CSVLogger(storageDir);
      await logger.init();

      const campaignMedia = await this.resolveCampaignMedia();

      await this.store.saveCampaignMedia(campaignMedia);
      await this.store.seedContacts(
        uniqueTasks.map((t) => ({
          phone: t.number,
          text: t.text,
          hasMedia: Boolean(campaignMedia)
        })),
        true
      );

      const pendingRecords: ContactRecord[] = ArrayUtils.shuffle(this.store.getPendingContacts());

      if (pendingRecords.length === 0) {
        this.logToWindow('No hay contactos válidos pendientes en la cola.', 'warn');
        return;
      }

      this.isSending = true;
      this.isInitializing = false;
      await this.startExecution(pendingRecords, storageDir, logger, campaignMedia);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Error en addTasks:', err);
      this.logToWindow(`Error al inicializar la campaña: ${msg}`, 'error');
    } finally {
      this.isInitializing = false;
    }
  }

  public async resumePending(config?: BulkSenderConfig, appSettings?: AppSettings) {
    if (this.isActive()) {
      this.logToWindow('Ya existe una campaña en ejecución.', 'warn');
      return;
    }

    this.isInitializing = true;
    try {
      this.mergeSafetyIntoConfig(appSettings, config);
      const userDataDir = appElectron.app ? appElectron.app.getPath('userData') : process.cwd();
      const storageDir = this.config.storageDir || path.join(userDataDir, 'sender_storage');

      await this.store.init();
      await this.blacklist.init();

      const pendingRecords = ArrayUtils.shuffle(this.store.getPendingContacts());
      if (pendingRecords.length === 0) {
        this.logToWindow('No quedan contactos pendientes por reanudar en la cola guardada.', 'info');
        return;
      }

      const logger = new CSVLogger(storageDir);
      await logger.init();

      const needsMedia = pendingRecords.some((r) => r.hasMedia);
      const savedMedia = needsMedia ? await this.store.loadCampaignMedia() : null;
      if (needsMedia && !savedMedia) {
        this.logToWindow('Aviso: no se encontró el archivo multimedia en caché; se reanudará solo con texto.', 'warn');
      }

      this.logToWindow(`Reanudando campaña guardada con ${pendingRecords.length} contacto(s) pendientes.`, 'info');
      this.isSending = true;
      this.isInitializing = false;
      await this.startExecution(pendingRecords, storageDir, logger, savedMedia);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logToWindow(`Error al reanudar la campaña: ${msg}`, 'error');
    } finally {
      this.isInitializing = false;
    }
  }

  public stop() {
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }
  }

  private emitToWindow(channel: string, payload: unknown) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  private logToWindow(msg: string, type: 'info' | 'success' | 'error' | 'warn' = 'info') {
    this.emitToWindow('bulk-log', { msg, type });
  }

  private buildFullMessage(baseText: string): string {
    const userText = this.spintaxEnhancer.enrichText(baseText || '').trim();
    if (!this.config.includeOptOutFooter) {
      return userText;
    }
    const footer = (this.config.optOutFooterText || '').trim();
    if (!footer) return userText;
    return `${userText}\n\n—\n${footer}`;
  }

  private estimateTypingSeconds(textLength: number): number {
    const raw = Math.max(2000, Math.min(textLength * 115, 20000)) + 850;
    return raw / 1000;
  }

  private estimateRemainingSeconds(params: {
    currentStepMs: number;
    currentItemTailSec: number;
    futureCount: number;
    messagesSentInBatch: number;
    avgTextLength: number;
    hasMedia: boolean;
  }): number {
    const minD = Math.max(1, this.config.minDelay ?? 30);
    const maxD = Math.max(minD, this.config.maxDelay ?? 120);
    const avgDelaySec = (minD + maxD) / 2;
    const maxPerMin = this.config.maxPerMinute || 3;
    const cadenceSec = maxPerMin > 0 ? Math.max(avgDelaySec, 60 / maxPerMin) : avgDelaySec;
    const typingSec = this.estimateTypingSeconds(params.avgTextLength);
    const mediaSec = params.hasMedia ? 5.5 : 0;
    const checkSec = this.config.checkRegisteredBeforeSend ? 0.35 : 0;
    const reviewAmortizedSec = 37.5 / 11;

    const perFutureItemSec = cadenceSec + typingSec + mediaSec + checkSec + reviewAmortizedSec;
    let totalSec = params.currentStepMs / 1000 + params.currentItemTailSec + params.futureCount * perFutureItemSec;

    const batchSize = this.config.batchSize || 0;
    const restSec = Math.max(1, this.config.restMinutes || 1) * 60;
    if (batchSize > 0 && params.futureCount > 0) {
      const sentBeforeFuture = params.messagesSentInBatch + 1;
      const toNextRest = Math.max(1, batchSize - sentBeforeFuture);
      if (params.futureCount >= toNextRest) {
        const breaks = 1 + Math.floor((params.futureCount - toNextRest) / batchSize);
        totalSec += breaks * restSec;
      }
    }

    return Math.max(0, Math.round(totalSec));
  }

  private emitDelayWithEta(delayMs: number, reason: string, etaSeconds: number) {
    this.emitToWindow('bulk-delay', {
      delay: delayMs,
      reason,
      etaSeconds,
      startedAtMs: Date.now()
    });
  }

  private isSystemicError(result: SendResult): boolean {
    return result.statusCode === 401 || result.statusCode === 403 || result.statusCode === 429;
  }

  private async sendMandatorySelfReport(
    successCount: number,
    errorCount: number,
    skippedCount: number,
    timeStr: string
  ) {
    const reportMsg =
      `📊 *Reporte de Envío FCSender*\n\n` +
      `✅ Enviados: ${successCount}\n` +
      `❌ Fallidos: ${errorCount}\n` +
      `↷ Omitidos: ${skippedCount}\n` +
      `⏱️ Tiempo total: ${timeStr}`;

    const sent = await this.transport.sendSelfReport(reportMsg);
    if (sent) {
      this.logToWindow('Reporte automático enviado a tu mismo WhatsApp.', 'info');
    }
  }

  private async startExecution(
    records: ContactRecord[],
    storageDir: string,
    logger: CSVLogger,
    campaignMedia: SavedCampaignMedia | null
  ) {
    this.isSending = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    this.delaysEngine.reset();

    let messagesSentInBatch = 0;
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let consecutiveErrors = 0;
    const recentOutcomes: boolean[] = [];
    let stoppedByUser = false;
    let circuitBreakerTripped = false;
    const excelRows: CampaignExcelRow[] = [];
    const total = records.length;
    const threshold = Math.max(2, this.config.circuitBreakerThreshold || 5);
    const startTime = Date.now();
    const startedAt = new Date(startTime);
    const hasMedia = Boolean(campaignMedia);
    const sampleTextLength = (records[0]?.text || '').length;

    this.logToWindow(`Iniciando envío para ${total} contacto(s)...`, 'info');

    try {
      for (let index = 0; index < total; index++) {
        if (signal.aborted || this.shutdownHandler.shouldStop()) {
          stoppedByUser = true;
          this.logToWindow('Proceso detenido por el usuario.', 'warn');
          break;
        }

        const task = records[index];
        const remainingCount = total - index;
        const futureCount = Math.max(0, total - 1 - index);
        const itemTextLen = (task.text || '').length || sampleTextLength;
        const typingSec = this.estimateTypingSeconds(itemTextLen);
        const mediaTailSec = hasMedia && task.hasMedia !== false ? 5.5 : 0;
        const minD = Math.max(1, this.config.minDelay ?? 30);
        const maxD = Math.max(minD, this.config.maxDelay ?? 120);
        const avgDelaySec = (minD + maxD) / 2;
        const initialEta = this.estimateRemainingSeconds({
          currentStepMs: avgDelaySec * 1000,
          currentItemTailSec: typingSec + mediaTailSec,
          futureCount,
          messagesSentInBatch,
          avgTextLength: itemTextLen,
          hasMedia
        });

        this.emitToWindow('bulk-update', {
          queued: remainingCount,
          total,
          processed: index,
          successCount,
          errorCount,
          skippedCount,
          isSending: true,
          etaSeconds: initialEta
        });

        // 1. Verificación de Blacklist / Opt-Out
        if (this.blacklist.isBlacklisted(task.phone)) {
          skippedCount++;
          this.logToWindow(`[OMITIDO] ${task.phone} está en la lista de exclusión.`, 'warn');
          await this.store.updateStatus(task.phone, 'skipped', 'Omitido: Lista de exclusión');
          await logger.log(task.phone, 'SKIPPED_BLACKLIST', undefined, 0, 'Lista de exclusión');
          excelRows.push({
            phone: task.phone,
            status: 'OMITIDO',
            timestamp: new Date().toLocaleString(),
            detail: 'En lista de exclusión'
          });
          this.emitToWindow('bulk-progress', {
            status: 'skipped',
            number: task.phone,
            error: 'Lista de exclusión'
          });
          continue;
        }

        // 2. Descanso por lotes
        if (this.config.batchSize && this.config.batchSize > 0 && messagesSentInBatch >= this.config.batchSize) {
          const restMinutes = Math.max(1, this.config.restMinutes || 1);
          const sleepMs = restMinutes * 60 * 1000;
          const restEta = this.estimateRemainingSeconds({
            currentStepMs: sleepMs,
            currentItemTailSec: avgDelaySec + typingSec + mediaTailSec,
            futureCount,
            messagesSentInBatch: 0,
            avgTextLength: itemTextLen,
            hasMedia
          });
          this.logToWindow(
            `Lote de ${messagesSentInBatch} mensajes completado. Descansando ${restMinutes} min para proteger la cuenta.`,
            'info'
          );
          this.emitDelayWithEta(sleepMs, `Descanso entre lotes (${restMinutes} min)`, restEta);

          const completed = await interruptibleSleep(sleepMs, signal);
          if (!completed) {
            stoppedByUser = true;
            this.logToWindow('Descanso entre lotes interrumpido por el usuario.', 'warn');
            break;
          }
          messagesSentInBatch = 0;
        }

        try {
          // 3. Verificación previa de cuenta WhatsApp activa
          let resolvedJid: string | undefined;
          if (this.config.checkRegisteredBeforeSend) {
            const check = await this.transport.isRegisteredUser(task.phone, signal);
            if (signal.aborted) {
              stoppedByUser = true;
              break;
            }
            if (check.verified && !check.exists) {
              skippedCount++;
              this.logToWindow(`[OMITIDO] ${task.phone} no tiene cuenta WhatsApp registrada.`, 'warn');
              await this.store.updateStatus(task.phone, 'skipped', 'Número sin WhatsApp activo');
              await logger.log(task.phone, 'SKIPPED_UNREGISTERED', undefined, 0, 'Sin cuenta WhatsApp');
              excelRows.push({
                phone: task.phone,
                status: 'OMITIDO',
                timestamp: new Date().toLocaleString(),
                detail: 'Sin cuenta WhatsApp activa'
              });
              this.emitToWindow('bulk-progress', {
                status: 'skipped',
                number: task.phone,
                error: 'Sin cuenta WhatsApp activa'
              });
              await interruptibleSleep(300, signal);
              continue;
            }
            resolvedJid = check.jid;
          }

          // 4. Retardo aleatorio configurado
          const { completed } = await this.delaysEngine.waitCustomDelay(minD, maxD, signal, (delayMs) => {
            const delayEta = this.estimateRemainingSeconds({
              currentStepMs: delayMs,
              currentItemTailSec: typingSec + mediaTailSec,
              futureCount,
              messagesSentInBatch,
              avgTextLength: itemTextLen,
              hasMedia
            });
            this.emitDelayWithEta(delayMs, `Pausa aleatoria segura (${minD}-${maxD}s)`, delayEta);
          });
          if (!completed) {
            stoppedByUser = true;
            break;
          }

          // 5. Rate Limiter deslizante
          const slotOk = await this.rateLimiter.waitForSlot(signal, (waitMs) => {
            const slotEta = this.estimateRemainingSeconds({
              currentStepMs: waitMs,
              currentItemTailSec: typingSec + mediaTailSec,
              futureCount,
              messagesSentInBatch,
              avgTextLength: itemTextLen,
              hasMedia
            });
            this.emitDelayWithEta(waitMs, 'Control de límite por minuto', slotEta);
          });
          if (!slotOk) {
            stoppedByUser = true;
            break;
          }

          // 6. Construir mensaje con Spintax + Opt-out footer
          const fullMessageText = this.buildFullMessage(task.text || '');

          // 7. Generar variante única de imagen o vídeo POR CADA DESTINATARIO
          let processedMedia: ProcessedMedia | null = null;
          if (campaignMedia && task.hasMedia !== false) {
            processedMedia =
              campaignMedia.mediaType === 'video'
                ? await this.imageProcessor.processVideo(campaignMedia.buffer, campaignMedia.ext)
                : await this.imageProcessor.process(campaignMedia.buffer);

            const { completed: attachOk } = await this.delaysEngine.waitAttachmentPause(signal, (delayMs) => {
              const attachEta = this.estimateRemainingSeconds({
                currentStepMs: delayMs,
                currentItemTailSec: typingSec,
                futureCount,
                messagesSentInBatch,
                avgTextLength: itemTextLen,
                hasMedia
              });
              this.emitDelayWithEta(delayMs, 'Preparando archivo adjunto', attachEta);
            });
            if (!attachOk) {
              stoppedByUser = true;
              break;
            }
          }

          // 8. Envío con simulación humana de escritura y countdown en vivo
          const estSendMs = Math.round(typingSec * 1000) + (processedMedia ? 1500 : 400);
          const sendEta = this.estimateRemainingSeconds({
            currentStepMs: estSendMs,
            currentItemTailSec: 0,
            futureCount,
            messagesSentInBatch,
            avgTextLength: itemTextLen,
            hasMedia
          });
          this.emitDelayWithEta(estSendMs, `Enviando a +${task.phone}...`, sendEta);

          const itemStartTime = Date.now();
          let result: SendResult;

          if (processedMedia) {
            result = await this.transport.sendMediaBuffer(
              task.phone,
              processedMedia.buffer,
              processedMedia.filename,
              fullMessageText,
              signal,
              processedMedia.mediaType,
              processedMedia.mimeType,
              resolvedJid
            );
          } else {
            result = await this.transport.sendTextMessage(task.phone, fullMessageText, signal, resolvedJid);
          }

          if (signal.aborted) {
            stoppedByUser = true;
            break;
          }

          const latencyMs = Date.now() - itemStartTime;

          if (result.success) {
            consecutiveErrors = 0;
            recentOutcomes.push(true);
            if (recentOutcomes.length > 10) recentOutcomes.shift();

            await this.store.updateStatus(task.phone, 'sent');
            await logger.log(task.phone, 'SENT', result.messageId, latencyMs);
            excelRows.push({
              phone: task.phone,
              status: 'ENVIADO',
              timestamp: new Date().toLocaleString(),
              latencyMs,
              detail: result.messageId || 'Entregado'
            });

            messagesSentInBatch++;
            successCount++;
            this.emitToWindow('bulk-progress', {
              status: 'success',
              number: task.phone,
              latencyMs
            });
          } else {
            errorCount++;
            consecutiveErrors++;
            recentOutcomes.push(false);
            if (recentOutcomes.length > 10) recentOutcomes.shift();

            const errMsg = result.error || 'Fallo de entrega de mensaje';
            await this.store.updateStatus(task.phone, 'failed', errMsg);
            await logger.log(task.phone, 'FAILED', undefined, latencyMs, errMsg);
            excelRows.push({
              phone: task.phone,
              status: 'FALLIDO',
              timestamp: new Date().toLocaleString(),
              latencyMs,
              detail: errMsg
            });
            this.emitToWindow('bulk-progress', {
              status: 'error',
              number: task.phone,
              error: errMsg
            });

            const recentFailures = recentOutcomes.filter((ok) => !ok).length;
            const highWindowFailure = recentOutcomes.length >= 5 && recentFailures / recentOutcomes.length >= 0.8;

            if (this.isSystemicError(result) || consecutiveErrors >= threshold || highWindowFailure) {
              circuitBreakerTripped = true;
              this.logToWindow(
                `[PROTECCIÓN ACTIVADA] Campaña detenida preventivamente (${errMsg}). Revisa tu conexión antes de reanudar.`,
                'error'
              );
              break;
            }
          }

          // 9. Pausa de revisión periódica si quedan mensajes por enviar
          if (index < total - 1) {
            const { completed: reviewOk } = await this.delaysEngine.checkReviewPause(signal, (delayMs) => {
              const reviewEta = this.estimateRemainingSeconds({
                currentStepMs: delayMs,
                currentItemTailSec: 0,
                futureCount,
                messagesSentInBatch,
                avgTextLength: itemTextLen,
                hasMedia
              });
              this.logToWindow(`Pausa de control de seguridad: esperando ${Math.round(delayMs / 1000)}s...`, 'info');
              this.emitDelayWithEta(delayMs, 'Pausa periódica de control', reviewEta);
            });
            if (!reviewOk) {
              stoppedByUser = true;
              break;
            }
          }
        } catch (err: unknown) {
          if (signal.aborted) {
            stoppedByUser = true;
            break;
          }
          errorCount++;
          consecutiveErrors++;
          recentOutcomes.push(false);
          if (recentOutcomes.length > 10) recentOutcomes.shift();

          const errMsg = err instanceof Error ? err.message : 'Error desconocido';
          await this.store.updateStatus(task.phone, 'failed', errMsg);
          await logger.log(task.phone, 'FAILED', undefined, 0, errMsg);
          excelRows.push({
            phone: task.phone,
            status: 'FALLIDO',
            timestamp: new Date().toLocaleString(),
            detail: errMsg
          });
          this.emitToWindow('bulk-progress', {
            status: 'error',
            number: task.phone,
            error: errMsg
          });

          if (consecutiveErrors >= threshold) {
            circuitBreakerTripped = true;
            this.logToWindow(
              `[PROTECCIÓN ACTIVADA] Se detectaron ${consecutiveErrors} errores consecutivos. Campaña pausada automáticamente.`,
              'error'
            );
            break;
          }
        }
      }
    } finally {
      this.isSending = false;
      this.abortController = null;
      const finishedAt = new Date();
      const elapsedMs = finishedAt.getTime() - startTime;
      const elapsedMinutes = Math.floor(elapsedMs / 60000);
      const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
      const timeStr = elapsedMinutes > 0 ? `${elapsedMinutes}m ${elapsedSeconds}s` : `${elapsedSeconds}s`;

      let reportExcelPath: string | undefined;
      if (excelRows.length > 0) {
        try {
          reportExcelPath = await ExcelReportGenerator.generate({
            outputDir: storageDir,
            startedAt,
            finishedAt,
            durationStr: timeStr,
            successCount,
            errorCount,
            skippedCount,
            stoppedByUser,
            circuitBreakerTripped,
            rows: excelRows
          });
          this.logToWindow(`Excel de resumen generado: ${path.basename(reportExcelPath)}`, 'success');
        } catch (excelErr: unknown) {
          const msg = excelErr instanceof Error ? excelErr.message : 'Error generando Excel';
          this.logToWindow(`No se pudo generar el Excel de resumen: ${msg}`, 'warn');
        }

        await this.sendMandatorySelfReport(successCount, errorCount, skippedCount, timeStr);
      }

      this.emitToWindow('bulk-update', {
        queued: 0,
        total,
        processed: successCount + errorCount + skippedCount,
        successCount,
        errorCount,
        skippedCount,
        isSending: false,
        etaSeconds: 0
      });
      this.logToWindow(
        `Ronda finalizada (${timeStr}) · Exitosos: ${successCount} · Fallidos: ${errorCount} · Omitidos: ${skippedCount}`,
        errorCount > 0 || circuitBreakerTripped ? 'warn' : 'success'
      );
      this.emitToWindow('bulk-finish', {
        successCount,
        errorCount,
        skippedCount,
        timeStr,
        stoppedByUser,
        circuitBreakerTripped,
        reportExcelPath
      });
    }
  }
}
