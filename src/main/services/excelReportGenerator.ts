import fs from 'fs/promises';
import path from 'path';
import * as XLSX from 'xlsx';

export interface CampaignExcelRow {
  phone: string;
  status: 'ENVIADO' | 'FALLIDO' | 'OMITIDO' | 'PENDIENTE';
  timestamp: string;
  detail?: string;
  latencyMs?: number;
}

export interface CampaignExcelSummaryInput {
  outputDir: string;
  startedAt: Date;
  finishedAt: Date;
  durationStr: string;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  stoppedByUser: boolean;
  circuitBreakerTripped: boolean;
  rows: CampaignExcelRow[];
}

export class ExcelReportGenerator {
  static async generate(input: CampaignExcelSummaryInput): Promise<string> {
    const reportsDir = path.join(input.outputDir, 'reportes');
    await fs.mkdir(reportsDir, { recursive: true });

    const pad = (n: number) => String(n).padStart(2, '0');
    const d = input.finishedAt;
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const filePath = path.join(reportsDir, `Resumen_Campana_${stamp}.xlsx`);

    const wb = XLSX.utils.book_new();

    const summaryData = [
      ['FCSender Evolution — Resumen de Campaña', ''],
      ['Fecha de inicio', input.startedAt.toLocaleString()],
      ['Fecha de finalización', input.finishedAt.toLocaleString()],
      ['Duración total', input.durationStr],
      ['Total procesados', input.rows.length],
      ['Enviados con éxito', input.successCount],
      ['Fallidos', input.errorCount],
      ['Omitidos (exclusión / sin WhatsApp)', input.skippedCount],
      [
        'Estado de cierre',
        input.circuitBreakerTripped
          ? 'Pausado por protección automática'
          : input.stoppedByUser
          ? 'Detenido por el usuario'
          : 'Completado'
      ]
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    summarySheet['!cols'] = [{ wch: 36 }, { wch: 32 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Resumen');

    const detailRows = input.rows.map((r) => ({
      Teléfono: `+${r.phone.replace(/\D/g, '')}`,
      Estado: r.status,
      Hora: r.timestamp,
      'Latencia (ms)': r.latencyMs ?? 0,
      Observación: r.detail || ''
    }));
    const detailSheet = XLSX.utils.json_to_sheet(detailRows);
    detailSheet['!cols'] = [
      { wch: 18 },
      { wch: 12 },
      { wch: 22 },
      { wch: 14 },
      { wch: 40 }
    ];
    XLSX.utils.book_append_sheet(wb, detailSheet, 'Detalle de Envíos');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    await fs.writeFile(filePath, buffer);
    return filePath;
  }
}
