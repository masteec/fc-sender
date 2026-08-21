import electron from 'electron';
const { app } = electron;
import path from 'path';
import fs from 'fs/promises';

export interface BlacklistEntry {
  phone: string; // E.164 o dígitos limpios
  reason: 'opt_out' | 'manual' | 'reported';
  timestamp: string;
  triggerKeyword?: string;
}

export class BlacklistService {
  private filePath: string;
  private memoryCache: Map<string, BlacklistEntry> = new Map();
  private isLoaded = false;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'blacklist.json');
  }

  private async ensureLoaded() {
    if (this.isLoaded) return;
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const list: BlacklistEntry[] = JSON.parse(data);
      this.memoryCache.clear();
      list.forEach(item => {
        const clean = item.phone.replace(/\D/g, '');
        this.memoryCache.set(clean, item);
      });
    } catch {
      // Si el archivo no existe, lo inicializamos vacío
      this.memoryCache.clear();
      await this.saveToFile();
    }
    this.isLoaded = true;
  }

  private async saveToFile() {
    try {
      const list = Array.from(this.memoryCache.values());
      await fs.writeFile(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error al guardar blacklist en disco:', err);
    }
  }

  public async getBlacklist(): Promise<BlacklistEntry[]> {
    await this.ensureLoaded();
    return Array.from(this.memoryCache.values());
  }

  public async isBlacklisted(rawPhone: string): Promise<boolean> {
    await this.ensureLoaded();
    const clean = rawPhone.replace(/\D/g, '');
    if (!clean) return false;
    if (this.memoryCache.has(clean)) return true;

    // Comparación flexible de últimos 8 dígitos para compatibilidad nacional e internacional
    if (clean.length >= 8) {
      const suffix = clean.slice(-8);
      for (const key of this.memoryCache.keys()) {
        if (key.length >= 8 && key.slice(-8) === suffix) {
          return true;
        }
      }
    }

    return false;
  }

  public async addToBlacklist(
    rawPhone: string,
    reason: 'opt_out' | 'manual' | 'reported' = 'opt_out',
    triggerKeyword?: string
  ): Promise<boolean> {
    await this.ensureLoaded();
    const clean = rawPhone.replace(/\D/g, '');
    if (!clean) return false;

    if (this.memoryCache.has(clean)) {
      return false; // Ya existía
    }

    const entry: BlacklistEntry = {
      phone: clean,
      reason,
      timestamp: new Date().toISOString(),
      triggerKeyword
    };

    this.memoryCache.set(clean, entry);
    await this.saveToFile();
    return true;
  }

  public async removeFromBlacklist(rawPhone: string): Promise<boolean> {
    await this.ensureLoaded();
    const clean = rawPhone.replace(/\D/g, '');
    if (this.memoryCache.has(clean)) {
      this.memoryCache.delete(clean);
      await this.saveToFile();
      return true;
    }
    return false;
  }

  public async clearBlacklist(): Promise<void> {
    this.memoryCache.clear();
    await this.saveToFile();
  }
}

export const blacklistService = new BlacklistService();
