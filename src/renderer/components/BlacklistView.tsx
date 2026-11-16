import { useState } from 'react';
import { Ban, Plus, Search, Trash2 } from 'lucide-react';
import type { BlacklistEntry } from '../types';

interface BlacklistViewProps {
  entries: BlacklistEntry[];
  keywords: string[];
  onAddEntry: (phone: string, reason: string) => Promise<void>;
  onRemoveEntry: (phone: string) => Promise<void>;
  isDark: boolean;
}

export function BlacklistView({
  entries,
  keywords,
  onAddEntry,
  onRemoveEntry,
  isDark
}: BlacklistViewProps) {
  const [phoneInput, setPhoneInput] = useState('');
  const [reasonInput, setReasonInput] = useState('Exclusión manual');
  const [search, setSearch] = useState('');

  const cardClass = isDark
    ? 'bg-[#161B22] border-[#252B33] text-slate-100'
    : 'bg-white border-slate-200/90 text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.04)]';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneInput.trim()) return;
    await onAddEntry(phoneInput.trim(), reasonInput.trim());
    setPhoneInput('');
  };

  const filtered = entries.filter(
    (item) =>
      item.phone.includes(search.replace(/\D/g, '')) ||
      item.reason.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <div className="lg:col-span-8 space-y-5">
        <section className={`rounded-2xl border p-5 space-y-3 ${cardClass}`}>
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Ban className="w-4 h-4 text-rose-500" /> Agregar Número a Exclusión
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 text-xs">
            <input
              type="text"
              aria-label="Número de teléfono a excluir"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="Ej: 0991234567 o +593991234567"
              className={`sm:col-span-5 rounded-xl border px-3 py-2 font-mono ${
                isDark ? 'bg-[#0F1318] border-[#30363D]' : 'bg-slate-50 border-slate-200'
              }`}
            />
            <input
              type="text"
              aria-label="Motivo de exclusión"
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              placeholder="Motivo (ej: Solicitó baja)"
              className={`sm:col-span-5 rounded-xl border px-3 py-2 ${
                isDark ? 'bg-[#0F1318] border-[#30363D]' : 'bg-slate-50 border-slate-200'
              }`}
            />
            <button
              type="submit"
              disabled={!phoneInput.trim()}
              className="sm:col-span-2 rounded-xl bg-fc-600 hover:bg-fc-700 text-white font-bold px-3 py-2 flex items-center justify-center gap-1 disabled:opacity-40 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Agregar
            </button>
          </form>
        </section>

        <section className={`rounded-2xl border p-5 space-y-4 ${cardClass}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold">
              Números Excluidos <span className={`font-semibold tabular-nums ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>({entries.length})</span>
            </h2>
            <div className="relative w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Buscar número excluido"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar teléfono o motivo..."
                className={`w-full rounded-xl border pl-8 pr-3 py-1.5 text-xs ${
                  isDark ? 'bg-[#0F1318] border-[#30363D]' : 'bg-slate-50 border-slate-200'
                }`}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className={`text-xs py-8 text-center ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              No hay contactos en la lista de exclusión.
            </p>
          ) : (
            <div className={`divide-y max-h-96 overflow-y-auto ${isDark ? 'divide-[#252B33]' : 'divide-slate-200/70'}`}>
              {filtered.map((entry) => (
                <div key={entry.phone} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-mono font-bold tabular-nums">+{entry.phone}</p>
                    <p className={`text-[11px] truncate ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      {entry.reason} · {new Date(entry.addedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveEntry(entry.phone)}
                    className="p-1.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    aria-label={`Quitar +${entry.phone} de exclusión`}
                    title="Quitar de exclusión"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <aside className={`lg:col-span-4 rounded-2xl border p-5 space-y-3 ${cardClass}`}>
        <h3 className="text-sm font-bold">Palabras Clave de Baja (Diccionario)</h3>
        <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
          Si un contacto responde exactamente con alguna de estas palabras clave en WhatsApp, se añadirá automáticamente a esta lista de exclusión.
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {keywords.map((kw) => (
            <span
              key={kw}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono font-semibold ${
                isDark
                  ? 'bg-[#0F1318] border-[#30363D] text-slate-200'
                  : 'bg-slate-50 border-slate-200 text-slate-800'
              }`}
            >
              {kw}
            </span>
          ))}
        </div>
      </aside>
    </div>
  );
}
