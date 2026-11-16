export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  statusCode?: number;
  latencyMs: number;
}

export interface RegistrationCheckResult {
  exists: boolean;
  verified: boolean;
  jid?: string;
}

export interface ITransportService {
  isReady(): boolean;
  getConnectedPhone(): string | null;
  isRegisteredUser(recipient: string, signal?: AbortSignal): Promise<RegistrationCheckResult>;
  sendTextMessage(recipient: string, text: string, signal?: AbortSignal, resolvedJid?: string): Promise<SendResult>;
  sendMediaBuffer(
    recipient: string,
    buffer: Buffer,
    filename: string,
    caption?: string,
    signal?: AbortSignal,
    mediaType?: 'image' | 'video',
    mimeType?: string,
    resolvedJid?: string
  ): Promise<SendResult>;
  sendSelfReport(text: string): Promise<boolean>;
}
