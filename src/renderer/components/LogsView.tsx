import { useState } from 'react';
import {
  Activity,
  FolderOpen,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2
} from 'lucide-react';
import type { LogEntry, QueueSummary } from '../types';

interface LogsViewProps {
  logs: LogEntry[];
  queueSummary: QueueSummary;
  isSending: boolean;
  onRequestClearLogs: () => void;
  onRefreshQueue: () => void;
  onResumeQueue: () => void;
  onRetryFailed: () => void;
  onRequestClearQueue: () => void;
  onOpenLogsFolder: () => void;
  isDark: boolean;
}

export function LogsView({
  logs,
  queueSummary,
  isSending,
  onRequestClearLogs,
  onRefreshQueue,
  onResumeQueue,
  onRetryFailed,
  onRequestClearQueue,
  onOpenLogsFolder,
  isDark
}: LogsViewProps) {
  const [filter, setFilter] = useState<'all' | 'success' | 'error' | 'warn'>('all');

  const cardClass = isDark
    ? 'bg-[#161B22] border-[#252B33] text-slate-100'
    : 'bg-white border-slate-200/90 text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.04)]';

  const filteredLogs = logs.filter((l) => (filter === 'all' ? true : l.type === filter));

  return (
    <div className="space-y-5">
      {/* Persistent Queue Manager */}
      <section className={`rounded-2xl border p-5 space-y-4 ${cardClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold">Cola Persistente de Campaña</h2>
            <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Reanuda envíos interrumpidos o reintenta únicamente contactos con fallos técnicos (nunca excluidos)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRefreshQueue}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 ${
                isDark
                  ? 'bg-[#0F1318] border-[#30363D] text-slate-200 hover:bg-[#1C222B]'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Actualizar
            </button>

            <button
              type="button"
              onClick={onOpenLogsFolder}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 ${
                isDark
                  ? 'bg-[#0F1318] border-[#30363D] text-slate-200 hover:bg-[#1C222B]'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5 text-fc-500" /> Carpeta CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className={`rounded-xl border p-3 ${isDark ? 'bg-[#0F1318] border-[#252B33]' : 'bg-slate-50 border-slate-200/80'}`}>
            <p className={`text-[11px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Total</p>
            <p className="text-lg font-extrabold tabular-nums mt-0.5">{queueSummary.total}</p>
          </div>
          <div className={`rounded-xl border p-3 ${isDark ? 'bg-[#0F1318] border-[#252B33]' : 'bg-slate-50 border-slate-200/80'}`}>
            <p className={`text-[11px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Pendientes</p>
            <p className="text-lg font-extrabold text-amber-700 dark:text-amber-400 tabular-nums mt-0.5">{queueSummary.pending}</p>
          </div>
          <div className={`rounded-xl border p-3 ${isDark ? 'bg-[#0F1318] border-[#252B33]' : 'bg-slate-50 border-slate-200/80'}`}>
            <p className={`text-[11px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Enviados</p>
            <p className={`text-lg font-extrabold tabular-nums mt-0.5 ${isDark ? 'text-fc-400' : 'text-fc-600'}`}>{queueSummary.sent}</p>
          </div>
          <div className={`rounded-xl border p-3 ${isDark ? 'bg-[#0F1318] border-[#252B33]' : 'bg-slate-50 border-slate-200/80'}`}>
            <p className={`text-[11px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Fallidos</p>
            <p className="text-lg font-extrabold text-rose-600 dark:text-rose-400 tabular-nums mt-0.5">{queueSummary.failed}</p>
          </div>
          <div className={`rounded-xl border p-3 ${isDark ? 'bg-[#0F1318] border-[#252B33]' : 'bg-slate-50 border-slate-200/80'}`}>
            <p className={`text-[11px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Omitidos</p>
            <p className={`text-lg font-extrabold tabular-nums mt-0.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{queueSummary.skipped}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onResumeQueue}
            disabled={isSending || queueSummary.pending === 0}
            className="px-4 py-2 rounded-xl bg-fc-600 hover:bg-fc-700 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 transition-colors"
          >
            <Play className="w-3.5 h-3.5 fill-white" /> Reanudar Pendientes ({queueSummary.pending})
          </button>

          <button
            type="button"
            onClick={onRetryFailed}
            disabled={isSending || queueSummary.failed === 0}
            className={`px-4 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 transition-colors ${
              isDark
                ? 'bg-[#1D232C] border-[#30363D] text-slate-200 hover:bg-[#252C37]'
                : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reintentar Fallidos ({queueSummary.failed})
          </button>

          {queueSummary.total > 0 && (
            <button
              type="button"
              onClick={onRequestClearQueue}
              disabled={isSending}
              className="px-3.5 py-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 ml-auto"
            >
              <Trash2 className="w-3.5 h-3.5" /> Vaciar Cola
            </button>
          )}
        </div>
      </section>

      {/* Real-time Console */}
      <section className={`rounded-2xl border p-5 space-y-4 ${cardClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-fc-500" />
            <h2 className="text-sm font-bold">Consola en Tiempo Real</h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {(
              [
                ['all', 'Todos'],
                ['success', 'Exitosos'],
                ['warn', 'Alertas'],
                ['error', 'Errores']
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  filter === key
                    ? 'bg-fc-600 text-white'
                    : isDark
                    ? 'bg-[#0F1318] text-slate-300 hover:text-white'
                    : 'bg-slate-100 text-slate-700 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}

            {logs.length > 0 && (
              <button
                type="button"
                onClick={onRequestClearLogs}
                className="ml-2 px-2.5 py-1 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 font-semibold"
              >
                Limpiar consola
              </button>
            )}
          </div>
        </div>

        <div
          className={`rounded-xl border p-3.5 font-mono text-xs h-[360px] overflow-y-auto space-y-1.5 ${
            isDark ? 'bg-[#0B0F14] border-[#252B33]' : 'bg-slate-950 border-slate-800 text-slate-200'
          }`}
        >
          {filteredLogs.length === 0 ? (
            <p className="text-slate-400 italic">No hay eventos registrados en esta vista...</p>
          ) : (
            filteredLogs.map((log) => {
              const colorClass =
                log.type === 'error'
                  ? 'text-rose-400'
                  : log.type === 'success'
                  ? 'text-fc-400'
                  : log.type === 'warn'
                  ? 'text-amber-300'
                  : 'text-slate-300';

              return (
                <div key={log.id} className={`flex gap-2.5 leading-relaxed ${colorClass}`}>
                  <span className="text-slate-400 shrink-0 tabular-nums">[{log.time}]</span>
                  <span className="flex-1 break-words">{log.msg}</span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
