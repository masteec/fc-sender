import { useState } from 'react';
import { CheckCircle2, Save, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AppSettingsData, SafetySettings } from '../types';

interface ProtectionViewProps {
  settings: AppSettingsData;
  onSaveSafety: (safety: SafetySettings) => Promise<void>;
  isDark: boolean;
}

const SHIELDS = [
  {
    title: 'Control de Frecuencia por Minuto',
    desc: 'Ventana móvil de 60 segundos que evita ráfagas repentinas incluso tras pausas.'
  },
  {
    title: 'Variación Dinámica de Mensajes',
    desc: 'Genera texto único por destinatario mediante expresiones Spintax.'
  },
  {
    title: 'Protección Multimedia por Envío',
    desc: 'Cada destinatario recibe una copia única e irrepetible de la imagen o video adjunto.'
  },
  {
    title: 'Simulación Humana de Escritura',
    desc: 'Aplica estado en línea y escritura proporcional antes de cada envío.'
  },
  {
    title: 'Validación Previa + Baja Automática',
    desc: 'Verifica si el contacto tiene WhatsApp activo y excluye automáticamente a quien responda STOP o BAJA.'
  },
  {
    title: 'Orden Aleatorio y Pausa Preventiva',
    desc: 'Mezcla la lista de envío y detiene la campaña ante fallos consecutivos.'
  }
];

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function ProtectionView({ settings, onSaveSafety, isDark }: ProtectionViewProps) {
  const [safety, setSafety] = useState<SafetySettings>(settings.safety);
  const [saving, setSaving] = useState(false);

  const cardClass = isDark
    ? 'bg-[#161B22] border-[#252B33] text-slate-100'
    : 'bg-white border-slate-200/90 text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.04)]';

  const inputClass = `w-full rounded-xl border px-3 py-2 text-xs ${
    isDark ? 'bg-[#0F1318] border-[#30363D] text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-900'
  }`;

  const iconBoxClass = isDark
    ? 'p-2 rounded-lg bg-fc-500/15 text-fc-400 border border-fc-500/30'
    : 'p-2 rounded-lg bg-fc-50 text-fc-600 border border-fc-200';

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveSafety(safety);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <section className={`lg:col-span-7 rounded-2xl border p-5 space-y-5 ${cardClass}`}>
        <div className="flex items-center gap-2.5">
          <div className={iconBoxClass}>
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold">Política de Protección de Comunicaciones</h2>
            <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Ajusta los umbrales de seguridad para evitar bloqueos y falsos positivos de spam
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label htmlFor="safety-max-per-min" className="font-semibold block mb-1">Máximo de mensajes por minuto</label>
            <input
              id="safety-max-per-min"
              type="number"
              min={1}
              max={30}
              value={safety.maxPerMinute}
              onChange={(e) =>
                setSafety((s) => ({ ...s, maxPerMinute: clampInt(e.target.value, 1, 30, s.maxPerMinute) }))
              }
              className={inputClass}
            />
            <p className={`text-[10px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Recomendado para proteger la línea: 2–4 por minuto.
            </p>
          </div>

          <div>
            <label htmlFor="safety-cb-threshold" className="font-semibold block mb-1">Pausa preventiva (fallos seguidos)</label>
            <input
              id="safety-cb-threshold"
              type="number"
              min={2}
              max={20}
              value={safety.circuitBreakerThreshold}
              onChange={(e) =>
                setSafety((s) => ({
                  ...s,
                  circuitBreakerThreshold: clampInt(e.target.value, 2, 20, s.circuitBreakerThreshold)
                }))
              }
              className={inputClass}
            />
            <p className={`text-[10px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Pausa la campaña automáticamente tras N errores seguidos.
            </p>
          </div>

          <div>
            <label htmlFor="safety-batch-size" className="font-semibold block mb-1">Tamaño de lote (mensajes)</label>
            <input
              id="safety-batch-size"
              type="number"
              min={0}
              max={200}
              value={safety.batchSize}
              onChange={(e) =>
                setSafety((s) => ({ ...s, batchSize: clampInt(e.target.value, 0, 200, s.batchSize) }))
              }
              className={inputClass}
            />
            <p className={`text-[10px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              0 desactiva los descansos entre lotes.
            </p>
          </div>

          <div>
            <label htmlFor="safety-rest-minutes" className="font-semibold block mb-1">Descanso entre lotes (minutos)</label>
            <input
              id="safety-rest-minutes"
              type="number"
              min={1}
              max={60}
              value={safety.restMinutes}
              onChange={(e) =>
                setSafety((s) => ({ ...s, restMinutes: clampInt(e.target.value, 1, 60, s.restMinutes) }))
              }
              className={inputClass}
            />
          </div>
        </div>

        <div className="space-y-3 pt-1 text-xs">
          <label htmlFor="safety-check-registered" className="flex items-start gap-2.5 cursor-pointer">
            <input
              id="safety-check-registered"
              type="checkbox"
              checked={safety.checkRegisteredBeforeSend}
              onChange={(e) => setSafety((s) => ({ ...s, checkRegisteredBeforeSend: e.target.checked }))}
              className="mt-0.5 accent-fc-600"
            />
            <div>
              <span className="font-semibold block">Verificar cuenta WhatsApp activa antes de enviar</span>
              <span className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Omite números sin WhatsApp registrado para reducir rebotes sospechosos.
              </span>
            </div>
          </label>

          <label htmlFor="safety-optout-footer" className="flex items-start gap-2.5 cursor-pointer">
            <input
              id="safety-optout-footer"
              type="checkbox"
              checked={safety.includeOptOutFooter}
              onChange={(e) => setSafety((s) => ({ ...s, includeOptOutFooter: e.target.checked }))}
              className="mt-0.5 accent-fc-600"
            />
            <div>
              <span className="font-semibold block">Incluir pie transparente de baja (Opt-Out)</span>
              <span className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Reduce los reportes de spam al dar una salida clara al receptor.
              </span>
            </div>
          </label>

          {safety.includeOptOutFooter && (
            <div>
              <label htmlFor="safety-optout-text" className="font-semibold block mb-1">Texto del pie de baja</label>
              <input
                id="safety-optout-text"
                type="text"
                value={safety.optOutFooterText}
                onChange={(e) => setSafety((s) => ({ ...s, optOutFooterText: e.target.value }))}
                className={inputClass}
              />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-fc-600 hover:bg-fc-700 text-white text-xs font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Guardando...' : 'Guardar Política de Protección'}
        </button>
      </section>

      <aside className={`lg:col-span-5 rounded-2xl border p-5 space-y-3.5 ${cardClass}`}>
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-fc-500" />
          <h3 className="text-sm font-bold">Escudos Activos en el Motor</h3>
        </div>
        <div className="space-y-2.5">
          {SHIELDS.map((shield) => (
            <div
              key={shield.title}
              className={`rounded-xl border p-3 flex items-start gap-2.5 ${
                isDark ? 'bg-[#0F1318] border-[#252B33]' : 'bg-slate-50/85 border-slate-200/80'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 text-fc-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold">{shield.title}</p>
                <p className={`text-[11px] mt-0.5 leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  {shield.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
