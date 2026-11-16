import fs from 'fs/promises';
import path from 'path';

export class CSVLogger {
  private filePath: string;

  constructor(outputDir: string) {
    this.filePath = path.join(outputDir, `send_audit_${new Date().toISOString().slice(0, 10)}.csv`);
  }

  async init(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.stat(this.filePath);
    } catch {
      await fs.writeFile(
        this.filePath,
        'Timestamp,Contact,Status,MessageID,LatencyMs,Error\n',
        'utf-8'
      );
    }
  }

  async log(contact: string, status: string, messageId?: string, latencyMs?: number, error?: string): Promise<void> {
    const cleanError = error ? error.replace(/[\r\n]+/g, ' ').replace(/"/g, '""') : '';
    const line = `${new Date().toISOString()},${contact},${status},${messageId || ''},${latencyMs || 0},"${cleanError}"\n`;
    await fs.appendFile(this.filePath, line, 'utf-8');
  }
}
