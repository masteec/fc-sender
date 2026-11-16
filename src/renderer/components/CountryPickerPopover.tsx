import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { COUNTRY_CODES, type CountryCodeOption } from '../../shared/phoneUtils';

interface CountryPickerPopoverProps {
  anchorRect: DOMRect;
  currentDial?: string;
  onSelectCountry: (country: CountryCodeOption) => void;
  onClose: () => void;
  isDark: boolean;
}

export function CountryPickerPopover({
  anchorRect,
  currentDial,
  onSelectCountry,
  onClose,
  isDark
}: CountryPickerPopoverProps) {
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const popoverWidth = 264;
  const estimatedHeight = 290;
  const margin = 10;
  const left = Math.max(margin, Math.min(anchorRect.left, window.innerWidth - popoverWidth - margin));
  const fitsBelow = anchorRect.bottom + 6 + estimatedHeight <= window.innerHeight - margin;
  const top = fitsBelow
    ? anchorRect.bottom + 6
    : Math.max(margin, anchorRect.top - estimatedHeight - 6);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, '');
    if (!q) return COUNTRY_CODES;
    return COUNTRY_CODES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.iso.toLowerCase().includes(q)
    );
  }, [query]);

  const pinnedItems = filtered.filter((c) => c.pinned);
  const otherItems = filtered.filter((c) => !c.pinned);

  const renderRow = (country: CountryCodeOption) => {
    const isSelected = currentDial === country.dial;
    return (
      <button
        key={`${country.iso}-${country.dial}`}
        type="button"
        onClick={() => onSelectCountry(country)}
        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs flex items-center justify-between gap-2 transition-colors ${
          isSelected
            ? isDark
              ? 'bg-fc-500/20 text-fc-200 font-bold'
              : 'bg-fc-50 text-fc-700 font-bold'
            : isDark
            ? 'hover:bg-[#1D232C] text-slate-200'
            : 'hover:bg-slate-100 text-slate-800'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0 truncate">
          <span className="text-sm leading-none shrink-0">{country.flag}</span>
          <span className="truncate">{country.name}</span>
        </span>
        <span className={`font-mono text-[11px] shrink-0 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          +{country.dial}
        </span>
      </button>
    );
  };

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Seleccionar código de país"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: `${popoverWidth}px`,
        zIndex: 9999
      }}
      className={`rounded-xl border p-2 shadow-2xl space-y-2 ${
        isDark ? 'bg-[#161B22] border-[#30363D] text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      }`}
    >
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar país o código (+34, USA)..."
          className={`w-full rounded-lg border pl-8 pr-2.5 py-1.5 text-xs ${
            isDark
              ? 'bg-[#0F1318] border-[#30363D] text-slate-100 placeholder:text-slate-500'
              : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400'
          }`}
        />
      </div>

      <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
        {pinnedItems.length > 0 && (
          <div className="space-y-0.5">
            {pinnedItems.map(renderRow)}
            {otherItems.length > 0 && (
              <div className={`my-1.5 border-t ${isDark ? 'border-[#252B33]' : 'border-slate-100'}`} />
            )}
          </div>
        )}
        {otherItems.map(renderRow)}
        {filtered.length === 0 && (
          <p className={`text-[11px] text-center py-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Sin coincidencias
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
