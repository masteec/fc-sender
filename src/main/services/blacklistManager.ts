import fs from 'fs/promises';
import path from 'path';
import { normalizePhoneDigits } from '../../shared/phoneUtils';

export interface BlacklistEntry {
  phone: string;
  reason: string;
  addedAt: string;
}

const OPT_OUT_KEYWORDS = ['STOP', 'BAJA'];

export class BlacklistManager {
  private filePath: string;
  private blacklistedNumbers: Set<string> = new Set();
  private entries: Map<string, BlacklistEntry> = new Map();
  private isLoaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageDir: string, dbName = 'blacklist.json') {
    this.filePath = path.join(storageDir, dbName);
  }

  public async init(): Promise<void> {
    if (this.isLoaded) return;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const data = await fs.readFile(this.filePath, 'utf-8');
      const list: BlacklistEntry[] = JSON.parse(data);
      this.blacklistedNumbers.clear();
      this.entries.clear();
      for (const item of list) {
        const cleanPhone = (item.phone || '').replace(/\D/g, '');
        if (!cleanPhone) continue;
        this.blacklistedNumbers.add(cleanPhone);
        this.entries.set(cleanPhone, { ...item, phone: cleanPhone });
      }
    } catch {
      this.blacklistedNumbers.clear();
      this.entries.clear();
      await this.save();
    }
    this.isLoaded = true;
  }

  public isBlacklisted(phone: string): boolean {
    const clean = normalizePhoneDigits(phone) || (phone || '').replace(/\D/g, '');
    if (!clean) return false;
    return this.blacklistedNumbers.has(clean);
  }

  public isOptOutKeyword(messageText: string): boolean {
    if (!messageText) return false;

    const normalized = messageText
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();

    return OPT_OUT_KEYWORDS.some((keyword) => {
      const cleanKeyword = keyword
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
      const escaped = cleanKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return normalized === cleanKeyword || new RegExp(`\\b${escaped}\\b`, 'i').test(normalized);
    });
  }

  public getOptOutKeywords(): string[] {
    return [...OPT_OUT_KEYWORDS];
  }

  public async add(phone: string, reason = 'Exclusión manual'): Promise<BlacklistEntry | null> {
    if (!this.isLoaded) await this.init();
    const clean = normalizePhoneDigits(phone);
    if (!clean) return null;

    const entry: BlacklistEntry = {
      phone: clean,
      reason: reason.trim() || 'Exclusión manual',
      addedAt: new Date().toISOString()
    };
    this.blacklistedNumbers.add(clean);
    this.entries.set(clean, entry);
    await this.save();
    return entry;
  }

  public async remove(phone: string): Promise<void> {
    if (!this.isLoaded) await this.init();
    const clean = (phone || '').replace(/\D/g, '');
    if (!clean) return;
    this.blacklistedNumbers.delete(clean);
    this.entries.delete(clean);
    await this.save();
  }

  public getAll(): BlacklistEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  private save(): Promise<void> {
    const data = Array.from(this.entries.values());
    const tmpPath = `${this.filePath}.tmp`;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }
}
