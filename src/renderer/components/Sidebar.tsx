import {
  Activity,
  Ban,
  Download,
  LogOut,
  QrCode,
  Send,
  ShieldCheck
} from 'lucide-react';
import fcLogo from '../assets/fc-logo.png';
import type { NavTab, WhatsAppStatus } from '../types';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  waStatus: WhatsAppStatus;
  appVersion: string;
  blacklistCount: number;
  queuedPendingCount: number;
  isSending: boolean;
  onOpenQrModal: () => void;
  onLogoutWhatsApp: () => void;
  isDark: boolean;
}

const NAV_ITEMS: { id: NavTab; label: string; description: string; icon: typeof Send }[] = [
  { id: 'campaign', label: 'Campañas', description: 'Audiencia y envío', icon: Send },
  { id: 'logs', label: 'Registros y Cola', description: 'Consola y reportes', icon: Activity },
  { id: 'blacklist', label: 'Exclusiones', description: 'Lista Opt-Out', icon: Ban },
  { id: 'protection', label: 'Protección', description: 'Escudos anti-spam', icon: ShieldCheck },
  { id: 'updates', label: 'Actualizaciones', description: 'Versiones y OTA', icon: Download }
];

export function Sidebar({
  activeTab,
  onSelectTab,
  waStatus,
  appVersion,
  blacklistCount,
  queuedPendingCount,
  isSending,
  onOpenQrModal,
  onLogoutWhatsApp,
  isDark
}: SidebarProps) {
  const isReady = waStatus.status === 'READY';

  return (
    <aside
      className={`w-64 shrink-0 border-r flex flex-col justify-between select-none transition-colors ${
        isDark
          ? 'bg-[#12161C] border-[#252B33] text-slate-200'
          : 'bg-white border-slate-200/90 text-slate-800'
      }`}
    >
      <div>
        <div
          className={`px-5 py-4 border-b flex items-center gap-3 ${
            isDark ? 'border-[#252B33]' : 'border-slate-100'
          }`}
        >
          <img
            src={fcLogo}
            alt="FCSender Logo"
            className="w-10 h-10 rounded-xl shadow-sm shrink-0 object-cover ring-1 ring-black/5"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-base font-extrabold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
                FCSender
              </span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${
                  isDark
                    ? 'bg-fc-500/15 text-fc-400 border border-fc-500/30'
                    : 'bg-fc-50 text-fc-600 border border-fc-200'
                }`}
              >
                v{appVersion}
              </span>
            </div>
            <p className={`text-[11px] font-semibold tracking-wide truncate ${isDark ? 'text-fc-400' : 'text-fc-600'}`}>
              Evolution
            </p>
          </div>
        </div>

        <nav className="p-3 space-y-1" aria-label="Navegación principal">
          <p
            className={`px-3 pt-1 pb-2 text-[10px] font-bold uppercase tracking-wider ${
              isDark ? 'text-slate-400' : 'text-slate-500'
            }`}
          >
            Espacio de trabajo
          </p>

          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            let badge: string | null = null;
            if (item.id === 'blacklist' && blacklistCount > 0) badge = String(blacklistCount);
            if (item.id === 'logs' && queuedPendingCount > 0) badge = String(queuedPendingCount);

            return (
              <button
                key={item.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all relative group ${
                  isActive
                    ? isDark
                      ? 'bg-fc-500/12 text-white border border-fc-500/30'
                      : 'bg-fc-50 text-fc-700 border border-fc-200 shadow-[0_1px_2px_rgba(0,197,83,0.06)]'
                    : isDark
                    ? 'text-slate-300 hover:text-white hover:bg-[#1B2028] border border-transparent'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-50 border border-transparent'
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-fc-500" />
                )}
                <div
                  className={`p-1.5 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-fc-600 text-white shadow-xs'
                      : isDark
                      ? 'bg-[#1D232C] text-slate-300 group-hover:text-white'
                      : 'bg-slate-100 text-slate-600 group-hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold leading-tight truncate">{item.label}</div>
                  <div
                    className={`text-[10px] truncate mt-0.5 ${
                      isActive
                        ? isDark
                          ? 'text-fc-200'
                          : 'text-fc-600'
                        : isDark
                        ? 'text-slate-400'
                        : 'text-slate-500'
                    }`}
                  >
                    {item.description}
                  </div>
                </div>
                {badge && (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
                      isActive
                        ? 'bg-fc-600 text-white'
                        : isDark
                        ? 'bg-slate-800 text-slate-200'
                        : 'bg-slate-200/80 text-slate-700'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Session Card */}
      <div className={`p-3 border-t ${isDark ? 'border-[#252B33]' : 'border-slate-100'}`}>
        <div
          className={`rounded-xl p-3 border text-xs space-y-2.5 ${
            isDark ? 'bg-[#171C23] border-[#252B33]' : 'bg-slate-50/90 border-slate-200/80'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              {isReady ? 'Sesión iniciada como:' : 'Estado de sesión'}
            </span>
            {isSending ? (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  isDark
                    ? 'bg-fc-500/15 text-fc-400 border-fc-500/30'
                    : 'bg-fc-50 text-fc-600 border-fc-200'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-fc-500 animate-ping" />
                Enviando
              </span>
            ) : (
              <span
                className={`w-2 h-2 rounded-full ${isReady ? 'bg-fc-500' : 'bg-amber-500 animate-pulse'}`}
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className={`font-mono font-bold text-xs truncate ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
              {isReady
                ? waStatus.phone
                  ? `+${waStatus.phone}`
                  : 'Sesión activa'
                : 'Sin vincular'}
            </span>
            {isReady ? (
              <button
                type="button"
                onClick={onLogoutWhatsApp}
                disabled={isSending}
                title="Cerrar sesión y cambiar de WhatsApp"
                aria-label="Cerrar sesión de WhatsApp"
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors disabled:opacity-40 shrink-0 ${
                  isDark
                    ? 'border-[#30363D] text-slate-300 hover:bg-rose-500/15 hover:text-rose-300 hover:border-rose-500/35'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                }`}
              >
                <LogOut className="w-3 h-3" />
                Salir
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenQrModal}
                className={`inline-flex items-center gap-1 text-[11px] font-semibold hover:underline shrink-0 ${
                  isDark ? 'text-fc-400' : 'text-fc-600'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" /> Ver QR
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
