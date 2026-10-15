import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import crypto from 'crypto';
import sharp from 'sharp';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';

export type VideoMutationMode = 'fast' | 'deep';

export class MediaProcessor {
  private static cachedFfmpegPath: string | null = null;

  public static getFfmpegPath(): string {
    if (this.cachedFfmpegPath) return this.cachedFfmpegPath;

    if (app && app.isPackaged) {
      const unpackedPath = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'ffmpeg-static',
        process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
      );
      if (fs.existsSync(unpackedPath)) {
        this.cachedFfmpegPath = unpackedPath;
        return unpackedPath;
      }
    }

    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      this.cachedFfmpegPath = ffmpegStatic;
      return ffmpegStatic;
    }

    this.cachedFfmpegPath = 'ffmpeg';
    return this.cachedFfmpegPath;
  }

  public static isVideo(input: string): boolean {
    if (!input) return false;
    if (input.startsWith('data:video/')) return true;
    const ext = path.extname(input).toLowerCase();
    return ['.mp4', '.mov', '.m4v', '.3gp', '.mkv', '.webm'].includes(ext);
  }

  public static isImage(input: string): boolean {
    if (!input) return false;
    if (input.startsWith('data:image/')) return true;
    const ext = path.extname(input).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(ext);
  }

  /**
   * Píxel Fantasma 2.0 para Imagen:
   * Micro-mutación de luminosidad/saturación y compresión para generar hash SHA256 único por destinatario.
   */
  public static async processImage(imageData: string): Promise<Buffer> {
    let buffer: Buffer;
    if (imageData.startsWith('data:image')) {
      const base64Data = imageData.split(';base64,').pop()!;
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      buffer = await fsPromises.readFile(imageData);
    }

    const brightnessMod = 1 + (Math.random() * 0.006 + 0.001);
    const saturationMod = 1 + (Math.random() * 0.004 - 0.002);

    const processedBuffer = await sharp(buffer)
      .withMetadata({ exif: {} })
      .modulate({
        brightness: brightnessMod,
        saturation: saturationMod,
      })
      .jpeg({
        quality: Math.floor(Math.random() * 3) + 90,
        chromaSubsampling: '4:4:4',
      })
      .toBuffer();

    return processedBuffer;
  }

  /**
   * Normaliza un video a MP4 H.264 / AAC con atom moov al inicio (+faststart) para compatibilidad universal en WhatsApp.
   */
  public static async normalizeVideoMaster(inputPath: string): Promise<string> {
    const tempDir = path.join(app.getPath('temp'), 'fcsender_video_cache');
    await fsPromises.mkdir(tempDir, { recursive: true });

    const normalizedOutput = path.join(tempDir, `master_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp4`);
    const ffmpegPath = this.getFfmpegPath();

    return new Promise((resolve, reject) => {
      // Intentar remuxing rápido con +faststart. Si falla el códec, se re-codifica a libx264/aac.
      const args = [
        '-y',
        '-i', inputPath,
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        normalizedOutput
      ];

      const proc = spawn(ffmpegPath, args);
      let stderr = '';

      proc.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });

      proc.on('close', async (code) => {
        if (code === 0 && fs.existsSync(normalizedOutput)) {
          resolve(normalizedOutput);
        } else {
          // Si falló el stream copy, transcodificar a H.264/AAC estándar
          console.warn('Stream copy falló, procediendo a transcodificación H.264 compatible:', stderr);
          const transcodeArgs = [
            '-y',
            '-i', inputPath,
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '24',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            normalizedOutput
          ];

          const transProc = spawn(ffmpegPath, transcodeArgs);
          let transErr = '';
          transProc.stderr.on('data', chunk => { transErr += chunk.toString(); });
          transProc.on('close', (tCode) => {
            if (tCode === 0 && fs.existsSync(normalizedOutput)) {
              resolve(normalizedOutput);
            } else {
              reject(new Error(`Error al normalizar video con FFmpeg: ${transErr}`));
            }
          });
        }
      });
    });
  }

  /**
   * Píxel Fantasma para Video (Vector Fantasma):
   * Modifica sutilmente la estructura y hash del video para que cada destinatario reciba un archivo con huella única.
   *
   * @param masterInput Path del video original o normalizado
   * @param mode 'fast' (inyección de átomo ISOBMFF free con payload aleatorio, 5ms) o 'deep' (FFmpeg remux con micro-drift acústico)
   */
  public static async mutateVideo(
    masterInput: string,
    mode: VideoMutationMode = 'fast'
  ): Promise<Buffer> {
    if (mode === 'fast') {
      // Mutación Estructural Rápida de Átomos ISOBMFF
      // Lee el video y añade una caja 'free' estándar con datos pseudoaleatorios al final del contenedor MP4.
      // Esto altera al 100% el MD5, SHA-1, SHA-256 y tamaño exacto del archivo sin tocar los streams de video ni romper offsets.
      const buffer = await fsPromises.readFile(masterInput);
      const payloadSize = Math.floor(Math.random() * 32) + 32; // 32 a 64 bytes de ruido
      const freeBox = Buffer.alloc(8 + payloadSize);

      // Box Size (Big Endian)
      freeBox.writeUInt32BE(8 + payloadSize, 0);
      // Box Type 'free'
      freeBox.write('free', 4, 'ascii');
      // Payload pseudoaleatorio único por destinatario
      crypto.randomFillSync(freeBox, 8, payloadSize);

      return Buffer.concat([buffer, freeBox]);
    } else {
      // Mutación Profunda con FFmpeg:
      // Remuxing con micro-variación acústica (+0.02% volumen) y metadatos dinámicos
      const tempDir = path.join(app.getPath('temp'), 'fcsender_video_cache');
      await fsPromises.mkdir(tempDir, { recursive: true });
      const outputPath = path.join(tempDir, `mutated_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.mp4`);
      const ffmpegPath = this.getFfmpegPath();

      const randomJitter = (1 + (Math.random() * 0.0008 - 0.0004)).toFixed(6);
      const randomUuid = crypto.randomUUID();

      const args = [
        '-y',
        '-i', masterInput,
        '-c:v', 'copy',
        '-filter:a', `volume=${randomJitter}`,
        '-c:a', 'aac',
        '-b:a', '128k',
        '-metadata', `comment=fc_${randomUuid}`,
        '-metadata', `title=FC_${Date.now()}`,
        '-movflags', '+faststart',
        outputPath
      ];

      return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, args);
        let errStr = '';
        proc.stderr.on('data', chunk => { errStr += chunk.toString(); });
        proc.on('close', async (code) => {
          if (code === 0 && fs.existsSync(outputPath)) {
            const buf = await fsPromises.readFile(outputPath);
            // Limpieza asíncrona del archivo temporal
            fsPromises.unlink(outputPath).catch(() => {});
            resolve(buf);
          } else {
            // Fallback a mutación rápida si fallara el remux profundo
            console.warn('Ffmpeg deep mutation falló, aplicando fallback a fast mode:', errStr);
            const fallbackBuf = await this.mutateVideo(masterInput, 'fast');
            resolve(fallbackBuf);
          }
        });
      });
    }
  }
}
