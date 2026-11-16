import { useState } from 'react';
import { CheckCircle2, Download, RefreshCw } from 'lucide-react';
import type { UpdaterStatus } from '../types';

interface UpdatesViewProps {
  appVersion: string;
  updaterStatus: UpdaterStatus;
  onCheckUpdates: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  isDark: boolean;
}

export function UpdatesView({
  appVersion,
  updaterStatus,
  onCheckUpdates,
  onInstallUpdate,
  isDark
}: UpdatesViewProps) {
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const cardClass = isDark
    ? 'bg-[#161B22] border-[#252B33] text-slate-100'
    : 'bg-white border-slate-200/90 text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.04)]';

  const versionBadgeClass = isDark
    ? 'text-xs font-bold px-3 py-1 rounded-full bg-fc-500/15 text-fc-200 border border-fc-500/30 tabular-nums'
    : 'text-xs font-bold px-3 py-1 rounded-full bg-fc-50 text-fc-600 border border-fc-200 tabular-nums';

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    try {
      await onCheckUpdates();
    } finally {
      setCheckingUpdate(false);
    }
  };

  const updateCheckDisabled =
    checkingUpdate ||
    updaterStatus.state === 'checking' ||
    updaterStatus.state === 'available' ||
    updaterStatus.state === 'downloading' ||
    updaterStatus.state === 'downloaded';

  return (
    <div className="max-w-xl mx-auto">
      <section className={`rounded-2xl border p-6 space-y-5 ${cardClass}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Actualizaciones de FCSender Evolution</h2>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Mantén tu aplicación siempre al día con mejoras de estabilidad y entrega
            </p>
          </div>
          <span className={versionBadgeClass}>v{appVersion}</span>
        </div>

        <div
          className={`rounded-xl border p-4 text-xs space-y-2.5 ${
            isDark ? 'bg-[#0F1318] border-[#252B33]' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2.5 font-semibold">
            {updaterStatus.state === 'downloaded' ? (
              <CheckCircle2 className="w-4 h-4 text-fc-500 shrink-0" />
            ) : (
              <Download className="w-4 h-4 text-fc-500 shrink-0" />
            )}
            <span>
              {updaterStatus.message || 'Haz clic en "Buscar Actualizaciones" para verificar nuevas versiones disponibles.'}
            </span>
          </div>

          {updaterStatus.state === 'downloading' && (
            <div className="space-y-1">
              <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                <div
                  className="h-full bg-fc-500 transition-all"
                  style={{ width: `${updaterStatus.percent ?? 0}%` }}
                />
              </div>
              <p className={`text-[11px] text-right tabular-nums ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {updaterStatus.percent ?? 0}%
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={handleCheckUpdates}
            disabled={updateCheckDisabled}
            className={`flex-1 py-2.5 px-4 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors ${
              isDark
                ? 'bg-[#1D232C] border-[#30363D] text-slate-100 hover:bg-[#252C37]'
                : 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />
            {checkingUpdate ? 'Consultando...' : 'Buscar Actualizaciones'}
          </button>

          {updaterStatus.state === 'downloaded' && (
            <button
              type="button"
              onClick={onInstallUpdate}
              className="flex-1 py-2.5 px-4 rounded-xl bg-fc-600 hover:bg-fc-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Instalar v{updaterStatus.version} y Reiniciar
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
