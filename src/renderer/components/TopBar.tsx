import { Download, Moon, Play, Square, Sun } from 'lucide-react';
import type { NavTab, UpdaterStatus } from '../types';

interface TopBarProps {
  activeTab: NavTab;
  updaterStatus: UpdaterStatus;
  isDark: boolean;
  isSending: boolean;
  contactsCount: number;
  queuedCount: number;
  canStartCampaign: boolean;
  onToggleTheme: () => void;
  onStartSend: () => void;
  onStopSend: () => void;
  onInstallUpdate: () => void;
}

const TAB_TITLES: Record<NavTab, { title: string; subtitle: string }> = {
  campaign: {
    title: 'Gestión de Campaña',
    subtitle: 'Prepara tu audiencia, personaliza tu mensaje y ejecuta con ritmo seguro'
  },
  logs: {
    title: 'Registros, Cola y Reportes',
    subtitle: 'Supervisión en tiempo real, reanudación de envíos y resúmenes Excel'
  },
  blacklist: {
    title: 'Lista de Exclusión (Opt-Out)',
    subtitle: 'Control de contactos excluidos manualmente o por respuesta automática'
  },
  protection: {
    title: 'Centro de Protección Anti-Spam',
    subtitle: 'Reglas de cadencia, pausas adaptativas y salvaguardas de cuenta'
  },
  updates: {
    title: 'Actualizaciones',
    subtitle: 'Verifica e instala nuevas versiones de FCSender Evolution'
  }
};

export function TopBar({
  activeTab,
  updaterStatus,
  isDark,
  isSending,
  contactsCount,
  queuedCount,
  canStartCampaign,
  onToggleTheme,
  onStartSend,
  onStopSend,
  onInstallUpdate
}: TopBarProps) {
  const info = TAB_TITLES[activeTab];

  return (
    <header
      className={`h-14 shrink-0 border-b px-6 flex items-center justify-between gap-4 transition-colors ${
        isDark
          ? 'bg-[#12161C]/95 border-[#252B33] text-slate-100'
          : 'bg-white/95 border-slate-200/90 text-slate-900'
      }`}
    >
      <div className="min-w-0">
        <h1 className="text-sm font-bold tracking-tight truncate">{info.title}</h1>
        <p className={`text-[11px] truncate ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          {info.subtitle}
        </p>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        {updaterStatus.state === 'downloaded' && (
          <button
            type="button"
            onClick={onInstallUpdate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fc-600 hover:bg-fc-700 text-white text-xs font-semibold shadow-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Instalar v{updaterStatus.version}</span>
          </button>
        )}

        {updaterStatus.state === 'downloading' && (
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border tabular-nums ${
              isDark
                ? 'bg-[#1B2028] border-[#30363D] text-slate-200'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            <Download className="w-3.5 h-3.5 text-fc-500 animate-bounce" />
            <span>Actualizando {updaterStatus.percent ?? 0}%</span>
          </div>
        )}

        <button
          type="button"
          onClick={onToggleTheme}
          title={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          aria-label="Cambiar tema de interfaz"
          className={`p-2 rounded-lg border transition-colors ${
            isDark
              ? 'bg-[#171C23] border-[#252B33] text-slate-200 hover:bg-[#1F2630]'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {!isSending ? (
          <button
            type="button"
            onClick={onStartSend}
            disabled={!canStartCampaign}
            className="px-4 py-2 rounded-xl bg-fc-600 hover:bg-fc-700 text-white font-bold text-xs tracking-wide shadow-xs transition-all disabled:opacity-40 flex items-center gap-2"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Iniciar Campaña ({contactsCount})</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onStopSend}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs tracking-wide shadow-xs transition-all flex items-center gap-2"
          >
            <Square className="w-3.5 h-3.5 fill-white" />
            <span>Detener ({queuedCount} rest.)</span>
          </button>
        )}
      </div>
    </header>
  );
}
