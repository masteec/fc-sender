export type NavTab = 'campaign' | 'logs' | 'blacklist' | 'protection' | 'updates';

export type ContactValidationStatus = 'unknown' | 'checking' | 'valid' | 'invalid' | 'blacklisted';

export interface ContactItem {
  phone: string; // +digits
  localNumber?: string;
  countryDial?: string;
  validation?: ContactValidationStatus;
}

export interface WhatsAppStatus {
  status: 'DISCONNECTED' | 'CONNECTING' | 'READY';
  qr?: string;
  phone?: string;
  name?: string;
  error?: string;
  message?: string;
}

export interface SendTask {
  number: string;
  text: string;
}

export interface SafetySettings {
  maxPerMinute: number;
  batchSize: number;
  restMinutes: number;
  includeOptOutFooter: boolean;
  optOutFooterText: string;
  checkRegisteredBeforeSend: boolean;
  circuitBreakerThreshold: number;
}

export interface AppSettingsData {
  safety: SafetySettings;
}

export interface BulkSenderConfig {
  batchSize?: number;
  restMinutes?: number;
  minDelay?: number;
  maxDelay?: number;
  sharedImageDataUrl?: string;
  sharedMediaPath?: string;
  sharedMediaType?: 'image' | 'video';
  sharedMediaExt?: string;
}

export interface BulkUpdateData {
  queued: number;
  total: number;
  processed: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  isSending: boolean;
  etaSeconds?: number;
}

export interface BulkFinishData {
  successCount: number;
  errorCount: number;
  skippedCount: number;
  timeStr: string;
  stoppedByUser: boolean;
  circuitBreakerTripped: boolean;
  reportExcelPath?: string;
}

export interface LogEntry {
  id: string;
  time: string;
  msg: string;
  type: 'info' | 'success' | 'error' | 'warn';
}

export interface ContactRecord {
  phone: string;
  text?: string;
  hasMedia?: boolean;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  sentAt?: string;
  error?: string;
}

export interface QueueSummary {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
  records: ContactRecord[];
}

export interface BlacklistEntry {
  phone: string;
  reason: string;
  addedAt: string;
}

export interface UpdaterStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'dev-mode';
  version?: string;
  percent?: number;
  message?: string;
}

export interface SpintaxTag {
  label: string;
  value: string;
}

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  type: 'success' | 'error' | 'info' | 'warn';
}

export interface SheetImportPreview {
  fileName: string;
  headers: string[];
  rows: string[][];
  phoneColIndex: number;
}

export interface ActiveDelayState {
  delay: number;
  reason: string;
  etaSeconds?: number;
  startedAtMs?: number;
}

declare global {
  interface Window {
    electronAPI: {
      getPathForFile: (file: File) => string;
      onWhatsAppStatus: (callback: (data: WhatsAppStatus) => void) => () => void;
      getWhatsAppStatus: () => void;
      logoutWhatsApp: () => Promise<{ ok: boolean; message?: string }>;
      checkWhatsAppNumber: (phone: string) => Promise<{
        phone: string;
        valid: boolean;
        verified: boolean;
        blacklisted: boolean;
      }>;
      checkWhatsAppBatch: (
        phones: string[]
      ) => Promise<Record<string, { valid: boolean; verified: boolean; blacklisted: boolean }>>;

      getSettings: () => void;
      saveSettings: (settings: Partial<AppSettingsData>) => Promise<{ settings: AppSettingsData }>;
      onAppSettingsData: (callback: (data: AppSettingsData) => void) => () => void;

      startBulkSend: (tasks: SendTask[], config: BulkSenderConfig) => void;
      resumeBulkSend: (config: BulkSenderConfig) => void;
      retryFailedSend: (config: BulkSenderConfig) => void;
      stopBulkSend: () => void;
      getQueueSummary: () => Promise<QueueSummary>;
      clearQueue: () => Promise<QueueSummary>;

      getBlacklist: () => Promise<{ entries: BlacklistEntry[]; keywords: string[] }>;
      addToBlacklist: (phone: string, reason?: string) => Promise<BlacklistEntry | null>;
      removeFromBlacklist: (phone: string) => Promise<boolean>;
      onBlacklistUpdated: (callback: () => void) => () => void;

      openLogsFolder: () => Promise<string>;
      openReportFile: (filePath: string) => Promise<boolean>;
      openExternal: (url: string) => void;

      getAppVersion: () => Promise<string>;
      getUpdaterStatus: () => Promise<UpdaterStatus>;
      checkForUpdates: () => Promise<UpdaterStatus | { ok: boolean }>;
      installUpdate: () => Promise<{ blocked: boolean; message?: string }>;
      onUpdaterStatus: (callback: (data: UpdaterStatus) => void) => () => void;

      onBulkSenderUpdate: (callback: (data: BulkUpdateData) => void) => () => void;
      onBulkSenderProgress: (
        callback: (data: {
          status: 'success' | 'error' | 'skipped';
          number: string;
          error?: string;
          latencyMs?: number;
        }) => void
      ) => () => void;
      onBulkSenderDelay: (callback: (data: ActiveDelayState) => void) => () => void;
      onBulkSenderLog: (
        callback: (data: { msg: string; type: 'info' | 'success' | 'error' | 'warn' }) => void
      ) => () => void;
      onBulkSenderFinish: (callback: (data: BulkFinishData) => void) => () => void;
    };
  }
}
