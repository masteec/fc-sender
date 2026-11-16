import crypto from 'crypto';
import sharp from 'sharp';

export interface ProcessedMedia {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  mediaType: 'image' | 'video';
}

export class ImageVariantProcessor {
  private formatExifDateTime(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private uniqueIdSuffix(): { dateStr: string; timeStr: string; randSuffix: string } {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const randSuffix = crypto.randomBytes(3).toString('hex');
    return { dateStr, timeStr, randSuffix };
  }

  async process(inputBuffer: Buffer): Promise<ProcessedMedia> {
    const quality = Math.floor(Math.random() * (93 - 84 + 1)) + 84;
    const brightness = 0.994 + Math.random() * 0.012;
    const saturation = 0.995 + Math.random() * 0.01;
    const offsetMs = (Math.random() * 4 - 2) * 3600 * 1000;
    const exifDate = this.formatExifDateTime(new Date(Date.now() + offsetMs));

    // Píxel fantasma imperceptible (1x1 casi transparente en coordenada aleatoria)
    const base = sharp(inputBuffer).rotate().flatten({ background: '#ffffff' });
    const meta = await base.metadata();
    const width = Math.max(2, meta.width || 64);
    const height = Math.max(2, meta.height || 64);
    const px = Math.floor(Math.random() * (width - 1));
    const py = Math.floor(Math.random() * (height - 1));
    const phantomPixel = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: {
          r: Math.floor(Math.random() * 255),
          g: Math.floor(Math.random() * 255),
          b: Math.floor(Math.random() * 255),
          alpha: 0.02
        }
      }
    })
      .png()
      .toBuffer();

    const processed = await base
      .composite([{ input: phantomPixel, left: px, top: py }])
      .modulate({ brightness, saturation })
      .jpeg({ quality, mozjpeg: true })
      .withMetadata({
        exif: { IFD0: { DateTime: exifDate } }
      })
      .toBuffer();

    const { dateStr, timeStr, randSuffix } = this.uniqueIdSuffix();
    return {
      buffer: processed,
      filename: `IMG_${dateStr}_${timeStr}_${randSuffix}.jpg`,
      mimeType: 'image/jpeg',
      mediaType: 'image'
    };
  }

  async processVideo(inputBuffer: Buffer, ext = 'mp4'): Promise<ProcessedMedia> {
    const cleanExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4';
    const { dateStr, timeStr, randSuffix } = this.uniqueIdSuffix();

    // Si es contenedor ISO BMFF (MP4/MOV), añadir un átomo 'free' válido al final para variar el hash e ID sin re-codificar
    const isIsoBmff =
      inputBuffer.length >= 12 && inputBuffer.subarray(4, 8).toString('ascii') === 'ftyp';

    let outputBuffer = inputBuffer;
    if (isIsoBmff) {
      const payloadSize = 16 + Math.floor(Math.random() * 17);
      const atomSize = 8 + payloadSize;
      const freeAtom = Buffer.alloc(atomSize);
      freeAtom.writeUInt32BE(atomSize, 0);
      freeAtom.write('free', 4, 4, 'ascii');
      crypto.randomBytes(payloadSize).copy(freeAtom, 8);
      outputBuffer = Buffer.concat([inputBuffer, freeAtom]);
    }

    const mimeMap: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      webm: 'video/webm'
    };

    return {
      buffer: outputBuffer,
      filename: `VID_${dateStr}_${timeStr}_${randSuffix}.${cleanExt}`,
      mimeType: mimeMap[cleanExt] || 'video/mp4',
      mediaType: 'video'
    };
  }
}
