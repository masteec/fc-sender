import fs from 'fs/promises';
import path from 'path';

export interface SafetySettings {
  maxPerMinute: number;
  batchSize: number;
  restMinutes: number;
  includeOptOutFooter: boolean;
  optOutFooterText: string;
  checkRegisteredBeforeSend: boolean;
  circuitBreakerThreshold: number;
}

export interface AppSettings {
  safety: SafetySettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  safety: {
    maxPerMinute: 3,
    batchSize: 25,
    restMinutes: 5,
    includeOptOutFooter: true,
    optOutFooterText: 'Para no recibir más avisos de este tipo, responde STOP o BAJA.',
    checkRegisteredBeforeSend: true,
    circuitBreakerThreshold: 5
  }
};

export class SettingsManager {
  private filePath: string;
  private settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  private isLoaded = false;

  constructor(storageDir: string, fileName = 'app_settings.json') {
    this.filePath = path.join(storageDir, fileName);
  }

  async init(): Promise<AppSettings> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const data = await fs.readFile(this.filePath, 'utf-8');
      const loaded = JSON.parse(data) as Partial<AppSettings>;
      this.settings = {
        safety: { ...DEFAULT_SETTINGS.safety, ...(loaded.safety || {}) }
      };
    } catch {
      this.settings = structuredClone(DEFAULT_SETTINGS);
      await this.save();
    }
    this.isLoaded = true;
    return this.settings;
  }

  getSettings(): AppSettings {
    return this.settings;
  }

  async saveSettings(newSettings: Partial<AppSettings>): Promise<AppSettings> {
    if (!this.isLoaded) await this.init();
    this.settings = {
      safety: { ...this.settings.safety, ...(newSettings.safety || {}) }
    };
    await this.save();
    return this.settings;
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8');
  }
}
