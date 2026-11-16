import fs from 'fs/promises';
import path from 'path';

export type ContactStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface ContactRecord {
  phone: string;
  name?: string;
  text?: string;
  hasMedia?: boolean;
  status: ContactStatus;
  sentAt?: string;
  error?: string;
}

export interface SavedCampaignMedia {
  buffer: Buffer;
  mediaType: 'image' | 'video';
  ext: string;
}

export interface QueueSummary {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
  records: ContactRecord[];
}

export class CampaignQueueStore {
  private filePath: string;
  private mediaFilePath: string;
  private mediaMetaPath: string;
  private memoryCache: Map<string, ContactRecord> = new Map();
  private isLoaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageDir: string, dbName = 'campaign_queue.json') {
    this.filePath = path.join(storageDir, dbName);
    this.mediaFilePath = path.join(storageDir, 'campaign_media.bin');
    this.mediaMetaPath = path.join(storageDir, 'campaign_media.meta.json');
  }

  async init(): Promise<void> {
    if (this.isLoaded) return;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const data = await fs.readFile(this.filePath, 'utf-8');
      const records: ContactRecord[] = JSON.parse(data);
      this.memoryCache.clear();
      for (const rec of records) {
        if (rec?.phone) {
          this.memoryCache.set(rec.phone, rec);
        }
      }
    } catch {
      this.memoryCache.clear();
      await this.save();
    }
    this.isLoaded = true;
  }

  async saveCampaignMedia(media: SavedCampaignMedia | null): Promise<void> {
    await fs.mkdir(path.dirname(this.mediaFilePath), { recursive: true });
    if (media) {
      await fs.writeFile(this.mediaFilePath, media.buffer);
      await fs.writeFile(
        this.mediaMetaPath,
        JSON.stringify({ mediaType: media.mediaType, ext: media.ext }),
        'utf-8'
      );
    } else {
      await fs.rm(this.mediaFilePath, { force: true }).catch(() => {});
      await fs.rm(this.mediaMetaPath, { force: true }).catch(() => {});
    }
  }

  async loadCampaignMedia(): Promise<SavedCampaignMedia | null> {
    try {
      const buffer = await fs.readFile(this.mediaFilePath);
      let mediaType: 'image' | 'video' = 'image';
      let ext = 'jpg';
      try {
        const metaRaw = await fs.readFile(this.mediaMetaPath, 'utf-8');
        const meta = JSON.parse(metaRaw) as { mediaType?: 'image' | 'video'; ext?: string };
        if (meta.mediaType === 'video' || meta.mediaType === 'image') mediaType = meta.mediaType;
        if (meta.ext) ext = meta.ext;
      } catch {
        // default image/jpg
      }
      return { buffer, mediaType, ext };
    } catch {
      return null;
    }
  }

  async seedContacts(
    contacts: { phone: string; name?: string; text?: string; hasMedia?: boolean }[],
    forceReset = true
  ): Promise<void> {
    if (!this.isLoaded) await this.init();
    if (forceReset) {
      this.memoryCache.clear();
    }

    for (const c of contacts) {
      if (forceReset || !this.memoryCache.has(c.phone)) {
        this.memoryCache.set(c.phone, {
          phone: c.phone,
          name: c.name,
          text: c.text,
          hasMedia: c.hasMedia,
          status: 'pending'
        });
      }
    }
    await this.save();
  }

  getPendingContacts(): ContactRecord[] {
    return Array.from(this.memoryCache.values()).filter((c) => c.status === 'pending');
  }

  getAllRecords(): ContactRecord[] {
    return Array.from(this.memoryCache.values());
  }

  getSummary(): QueueSummary {
    const records = this.getAllRecords();
    let pending = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const r of records) {
      if (r.status === 'sent') sent++;
      else if (r.status === 'failed') failed++;
      else if (r.status === 'skipped') skipped++;
      else pending++;
    }
    return { total: records.length, pending, sent, failed, skipped, records };
  }

  async updateStatus(phone: string, status: ContactStatus, error?: string): Promise<void> {
    const rec = this.memoryCache.get(phone) || { phone, status: 'pending' };
    rec.status = status;
    if (status === 'sent') {
      rec.sentAt = new Date().toISOString();
      delete rec.error;
    } else if (error) {
      rec.error = error;
    }
    this.memoryCache.set(phone, rec);
    await this.save();
  }

  async retryFailed(): Promise<number> {
    if (!this.isLoaded) await this.init();
    let count = 0;
    for (const [phone, rec] of this.memoryCache.entries()) {
      if (rec.status === 'failed') {
        this.memoryCache.set(phone, { ...rec, status: 'pending', error: undefined });
        count++;
      }
    }
    if (count > 0) await this.save();
    return count;
  }

  async clear(): Promise<void> {
    if (!this.isLoaded) await this.init();
    this.memoryCache.clear();
    await this.saveCampaignMedia(null);
    await this.save();
  }

  private save(): Promise<void> {
    const records = Array.from(this.memoryCache.values());
    const tmpPath = `${this.filePath}.tmp`;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(tmpPath, JSON.stringify(records, null, 2), 'utf-8');
      await fs.rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }
}
