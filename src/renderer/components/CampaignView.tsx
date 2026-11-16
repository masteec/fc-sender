import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  FileSpreadsheet,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Square,
  Trash2,
  Users,
  X
} from 'lucide-react';
import {
  detectAndFormatPhone,
  getCountryByDial,
  type CountryCodeOption
} from '../../shared/phoneUtils';
import { CountryPickerPopover } from './CountryPickerPopover';
import type {
  ActiveDelayState,
  AppSettingsData,
  BulkFinishData,
  BulkUpdateData,
  ContactItem,
  SheetImportPreview,
  SpintaxTag
} from '../types';

interface CampaignViewProps {
  contacts: ContactItem[];
  onSetContacts: React.Dispatch<React.SetStateAction<ContactItem[]>>;
  onAddContacts: (items: ContactItem[]) => void;
  onChangeContactCountry: (oldPhone: string, newDial: string) => Promise<void>;
  onVerifyAllContacts: () => void;
  isVerifyingContacts: boolean;
  highlightedDuplicates: string[];
  messageText: string;
  onChangeMessageText: (val: string) => void;
  spintaxTags: SpintaxTag[];
  onAddSpintaxTag: (tag: SpintaxTag) => void;
  onDeleteSpintaxTag: (index: number) => void;
  mediaPreview: string;
  mediaType: 'image' | 'video';
  mediaName: string;
  onSetMedia: (payload: { preview: string; path: string; type: 'image' | 'video'; ext: string; name: string }) => void;
  onClearMedia: () => void;
  minDelay: number;
  maxDelay: number;
  onChangeMinDelay: (val: number) => void;
  onChangeMaxDelay: (val: number) => void;
  settings: AppSettingsData;
  isSending: boolean;
  bulkProgress: BulkUpdateData;
  activeDelay: ActiveDelayState | null;
  etaAnchor: { seconds: number; updatedAtMs: number } | null;
  lastFinishReport: BulkFinishData | null;
  onDismissFinishReport: () => void;
  onOpenReportFile: (filePath: string) => void;
  onStopSend: () => void;
  onRequestConfirmClearContacts: () => void;
  onOpenProtectionTab: () => void;
  onNotify: (title: string, message?: string, type?: 'success' | 'error' | 'info' | 'warn') => void;
  isDark: boolean;
}

const ACCEPTED_FILE_TYPES = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv']
};

function resolveSpintaxPreview(text: string, seed: number): string {
  let out = text || '';
  let iter = 0;
  const regex = /\{([^{}]+)\}/;
  while (regex.test(out) && iter < 60) {
    iter++;
    out = out.replace(regex, (_m, group: string) => {
      const opts = group.split('|');
      return opts[(seed + iter) % opts.length] ?? '';
    });
  }
  return out.trim();
}

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) return `${hrs}:${pad(mins)}:${pad(secs)}`;
  return `${pad(mins)}:${pad(secs)}`;
}

export function CampaignView({
  contacts,
  onSetContacts,
  onAddContacts,
  onChangeContactCountry,
  onVerifyAllContacts,
  isVerifyingContacts,
  highlightedDuplicates,
  messageText,
  onChangeMessageText,
  spintaxTags,
  onAddSpintaxTag,
  onDeleteSpintaxTag,
  mediaPreview,
  mediaType,
  mediaName,
  onSetMedia,
  onClearMedia,
  minDelay,
  maxDelay,
  onChangeMinDelay,
  onChangeMaxDelay,
  settings,
  isSending,
  bulkProgress,
  activeDelay,
  etaAnchor,
  lastFinishReport,
  onDismissFinishReport,
  onOpenReportFile,
  onStopSend,
  onRequestConfirmClearContacts,
  onOpenProtectionTab,
  onNotify,
  isDark
}: CampaignViewProps) {
  const [manualInput, setManualInput] = useState('');
  const [fileName, setFileName] = useState(() => localStorage.getItem('ws_fileName') || '');
  const [contactSearch, setContactSearch] = useState('');
  const [openCountryPicker, setOpenCountryPicker] = useState<{ phone: string; rect: DOMRect } | null>(null);
  const [sheetPreview, setSheetPreview] = useState<SheetImportPreview | null>(null);
  const [showAddTagModal, setShowAddTagModal] = useState(false);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagValue, setNewTagValue] = useState('');
  const [previewSeed, setPreviewSeed] = useState(1);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const tagLabelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isSending) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 250);
    return () => clearInterval(timer);
  }, [isSending]);

  useEffect(() => {
    if (!showAddTagModal) return;
    tagLabelInputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowAddTagModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAddTagModal]);

  const cardClass = isDark
    ? 'bg-[#161B22] border-[#252B33] text-slate-100'
    : 'bg-white border-slate-200/90 text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.04)]';

  const subSurfaceClass = isDark
    ? 'bg-[#0F1318] border-[#252B33]'
    : 'bg-slate-50/85 border-slate-200/80';

  const badgeClass = isDark
    ? 'bg-fc-500/15 text-fc-200 border border-fc-500/30'
    : 'bg-fc-50 text-fc-600 border border-fc-200';

  const iconBoxClass = isDark
    ? 'p-2 rounded-lg bg-fc-500/15 text-fc-400 border border-fc-500/30'
    : 'p-2 rounded-lg bg-fc-50 text-fc-600 border border-fc-200';

  const parseTextToContacts = useCallback((rawText: string): ContactItem[] => {
    const lines = rawText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const parsed: ContactItem[] = [];

    for (const line of lines) {
      const parts = line.split(/[,;\s|]+/).map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        const detected = detectAndFormatPhone(part);
        if (detected) {
          parsed.push({
            phone: detected.phone,
            localNumber: detected.localNumber,
            countryDial: detected.countryDial,
            validation: 'checking'
          });
        }
      }
    }
    return parsed;
  }, []);

  const commitManualRaw = useCallback(
    (raw: string) => {
      const items = parseTextToContacts(raw);
      if (items.length === 0) {
        if (raw.replace(/[,;\s]/g, '').length > 0) {
          onNotify('Número inválido', 'Ingresa al menos 7 dígitos válidos.', 'warn');
        }
        return;
      }
      onAddContacts(items);
    },
    [onAddContacts, onNotify, parseTextToContacts]
  );

  const handleManualInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.includes(',') || val.includes(';') || val.includes('\n')) {
      commitManualRaw(val);
      setManualInput('');
    } else {
      setManualInput(val);
    }
  };

  const handleManualInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (manualInput.trim()) {
        commitManualRaw(manualInput);
        setManualInput('');
      }
    } else if (e.key === 'Backspace' && manualInput === '' && contacts.length > 0 && !isSending) {
      onSetContacts((prev) => prev.slice(0, -1));
    }
  };

  const handleManualPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (text && /[\n,;\t\s]/.test(text.trim())) {
      e.preventDefault();
      commitManualRaw(text);
      setManualInput('');
    }
  };

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setFileName(file.name);
      localStorage.setItem('ws_fileName', file.name);
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          if (!data) return;

          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawRows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

          const nonEmptyRows = rawRows
            .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []))
            .filter((r) => r.some((cell) => cell.length > 0));

          if (nonEmptyRows.length === 0) {
            onNotify('Archivo vacío', 'La hoja seleccionada no contiene datos.', 'warn');
            return;
          }

          const colCount = Math.max(...nonEmptyRows.map((r) => r.length));
          if (colCount === 1) {
            const parsed: ContactItem[] = [];
            for (const row of nonEmptyRows) {
              const detected = detectAndFormatPhone(row[0] || '');
              if (detected) {
                parsed.push({
                  phone: detected.phone,
                  localNumber: detected.localNumber,
                  countryDial: detected.countryDial,
                  validation: 'checking'
                });
              }
            }
            if (parsed.length === 0) {
              onNotify('Sin números válidos', 'No se detectaron teléfonos válidos.', 'warn');
              return;
            }
            onAddContacts(parsed);
            setSheetPreview(null);
            return;
          }

          const firstRow = nonEmptyRows[0];
          const looksLikeHeader = firstRow.some((cell) => /[a-zA-Z]{2,}/.test(cell) && !/\d{7,}/.test(cell));
          const headers = looksLikeHeader
            ? firstRow.map((h, i) => h || `Columna ${i + 1}`)
            : Array.from({ length: colCount }, (_, i) => `Columna ${i + 1}`);
          const dataRows = looksLikeHeader ? nonEmptyRows.slice(1) : nonEmptyRows;

          let detectedPhoneCol = headers.findIndex((h) =>
            /tel|phone|cel|num|movil|móvil|whats/i.test(h)
          );
          if (detectedPhoneCol < 0) {
            detectedPhoneCol = Math.max(
              0,
              headers.findIndex((_, colIdx) =>
                dataRows.slice(0, 10).some((r) => /\d{7,15}/.test((r[colIdx] || '').replace(/\D/g, '')))
              )
            );
          }

          setSheetPreview({
            fileName: file.name,
            headers,
            rows: dataRows,
            phoneColIndex: detectedPhoneCol
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Formato Excel/CSV no compatible.';
          onNotify('Error leyendo archivo', msg, 'error');
        }
      };

      reader.readAsArrayBuffer(file);
    },
    [onAddContacts, onNotify]
  );

  const handleConfirmSheetImport = () => {
    if (!sheetPreview) return;
    const imported: ContactItem[] = [];
    for (const row of sheetPreview.rows) {
      const rawPhone = row[sheetPreview.phoneColIndex] || '';
      const detected = detectAndFormatPhone(rawPhone);
      if (!detected) continue;
      imported.push({
        phone: detected.phone,
        localNumber: detected.localNumber,
        countryDial: detected.countryDial,
        validation: 'checking'
      });
    }
    if (imported.length === 0) {
      onNotify('Sin números válidos', 'No se encontraron números válidos en la columna elegida.', 'warn');
      return;
    }
    onAddContacts(imported);
    setSheetPreview(null);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    multiple: false
  });

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name);
    const ext = file.name.split('.').pop()?.toLowerCase() || (isVideo ? 'mp4' : 'jpg');
    const nativePath = window.electronAPI?.getPathForFile?.(file) || '';

    if (isVideo) {
      if (!nativePath) {
        onNotify('Archivo no compatible', 'Para videos adjuntos utiliza la aplicación de escritorio.', 'warn');
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      onSetMedia({
        preview: objectUrl,
        path: nativePath,
        type: 'video',
        ext,
        name: file.name
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      onSetMedia({
        preview: reader.result as string,
        path: nativePath,
        type: 'image',
        ext,
        name: file.name
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveMedia = () => {
    onClearMedia();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const insertToken = (value: string) => {
    if (!textAreaRef.current) {
      onChangeMessageText(messageText + value);
      return;
    }
    const start = textAreaRef.current.selectionStart;
    const end = textAreaRef.current.selectionEnd;
    const next = messageText.substring(0, start) + value + messageText.substring(end);
    onChangeMessageText(next);
    setTimeout(() => {
      if (textAreaRef.current) {
        textAreaRef.current.focus();
        textAreaRef.current.setSelectionRange(start + value.length, start + value.length);
      }
    }, 30);
  };

  const handleCreateTag = () => {
    if (!newTagLabel.trim() || !newTagValue.trim()) return;
    const formatted = newTagValue.trim().startsWith('{') ? newTagValue.trim() : `{${newTagValue.trim()}}`;
    onAddSpintaxTag({ label: newTagLabel.trim(), value: formatted });
    setNewTagLabel('');
    setNewTagValue('');
    setShowAddTagModal(false);
  };

  const handleMinDelayChange = (val: number) => {
    onChangeMinDelay(val);
    if (val > maxDelay) onChangeMaxDelay(val);
  };

  const handleMaxDelayChange = (val: number) => {
    onChangeMaxDelay(Math.max(val, minDelay));
  };

  const renderedPreview = useMemo(() => {
    const body = resolveSpintaxPreview(messageText, previewSeed);
    if (!body) return '';
    if (settings.safety.includeOptOutFooter && settings.safety.optOutFooterText.trim()) {
      return `${body}\n\n—\n${settings.safety.optOutFooterText.trim()}`;
    }
    return body;
  }, [messageText, previewSeed, settings.safety]);

  const hasSpintax = /\{[^{}]+\|[^{}]+\}/.test(messageText);
  const hasLowVariationRisk = contacts.length >= 10 && !hasSpintax;

  const invalidContactsCount = useMemo(
    () => contacts.filter((c) => c.validation === 'invalid' || c.validation === 'blacklisted').length,
    [contacts]
  );
  const validContactsCount = useMemo(
    () => contacts.filter((c) => c.validation === 'valid').length,
    [contacts]
  );

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.phone.toLowerCase().includes(q));
  }, [contacts, contactSearch]);

  const progressPct =
    bulkProgress.total > 0
      ? Math.min(100, Math.round((bulkProgress.processed / bulkProgress.total) * 100))
      : 0;

  const estimatedTotalSec = useMemo(() => {
    if (contacts.length === 0) return 0;
    const avgDelaySec = (minDelay + maxDelay) / 2;
    const maxPerMin = settings.safety.maxPerMinute || 3;
    const cadenceSec = maxPerMin > 0 ? Math.max(avgDelaySec, 60 / maxPerMin) : avgDelaySec;
    const typingSec = Math.max(2, Math.min(messageText.length * 0.115, 20)) + 0.85;
    const mediaSec = mediaPreview ? 5.5 : 0;
    const checkSec = settings.safety.checkRegisteredBeforeSend ? 0.35 : 0;
    const reviewSec = 37.5 / 11;
    let total = contacts.length * (cadenceSec + typingSec + mediaSec + checkSec + reviewSec);
    if (settings.safety.batchSize > 0 && contacts.length > settings.safety.batchSize) {
      const breaks = Math.floor((contacts.length - 1) / settings.safety.batchSize);
      total += breaks * settings.safety.restMinutes * 60;
    }
    return Math.round(total);
  }, [contacts.length, minDelay, maxDelay, messageText.length, mediaPreview, settings.safety]);

  const liveStepRemainingSec = activeDelay
    ? Math.max(0, Math.ceil(((activeDelay.startedAtMs || nowMs) + activeDelay.delay - nowMs) / 1000))
    : 0;
  const liveStepTotalSec = activeDelay ? Math.max(1, Math.round(activeDelay.delay / 1000)) : 1;
  const liveStepPct = activeDelay
    ? Math.min(100, Math.max(0, Math.round(((nowMs - (activeDelay.startedAtMs || nowMs)) / Math.max(1, activeDelay.delay)) * 100)))
    : 0;
  const liveEtaSec =
    isSending && etaAnchor
      ? Math.max(0, Math.round(etaAnchor.seconds - (nowMs - etaAnchor.updatedAtMs) / 1000))
      : null;

  return (
    <div className="space-y-5">
      {/* Card 1: Audiencia y Pills Inteligentes en Dos Mitades Horizontales */}
      <section className={`rounded-2xl border p-5 space-y-4 ${cardClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className={iconBoxClass}>
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold flex items-center gap-2">
                1. Audiencia de Destino
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums ${badgeClass}`}>
                  {contacts.length} contacto{contacts.length === 1 ? '' : 's'}
                </span>
              </h2>
              <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Escribe un número seguido de coma (,) a la izquierda o arrastra tu Excel/CSV a la derecha
              </p>
            </div>
          </div>

          {contacts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {(validContactsCount > 0 || invalidContactsCount > 0) && (
                <div className="flex items-center gap-2 text-[11px] font-semibold tabular-nums mr-1">
                  {validContactsCount > 0 && (
                    <span className={isDark ? 'text-fc-400' : 'text-fc-600'}>{validContactsCount} activos</span>
                  )}
                  {invalidContactsCount > 0 && (
                    <span className="text-rose-600 dark:text-rose-400">{invalidContactsCount} inválidos</span>
                  )}
                </div>
              )}
              <button
                type="button"
                disabled={isSending || isVerifyingContacts}
                onClick={onVerifyAllContacts}
                className={`text-xs px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 ${
                  isDark
                    ? 'bg-[#1D232C] border-[#30363D] text-fc-300 hover:border-fc-500'
                    : 'bg-fc-50 border-fc-200 text-fc-700 hover:bg-fc-100'
                }`}
              >
                {isVerifyingContacts ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5" />
                )}
                {isVerifyingContacts ? 'Verificando...' : 'Verificar números'}
              </button>
              {invalidContactsCount > 0 && (
                <button
                  type="button"
                  disabled={isSending || isVerifyingContacts}
                  onClick={() =>
                    onSetContacts((prev) =>
                      prev.filter((c) => c.validation !== 'invalid' && c.validation !== 'blacklisted')
                    )
                  }
                  className="text-xs px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold flex items-center gap-1 disabled:opacity-40"
                >
                  <AlertCircle className="w-3.5 h-3.5" /> Quitar inválidos ({invalidContactsCount})
                </button>
              )}
              <button
                type="button"
                onClick={onRequestConfirmClearContacts}
                disabled={isSending || isVerifyingContacts}
                className="text-xs text-rose-600 dark:text-rose-400 hover:underline font-semibold flex items-center gap-1 px-2 py-1 rounded-lg disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" /> Limpiar
              </button>
            </div>
          )}
        </div>

        {/* Two Equal Horizontal Halves: Left Manual Pills + Right CSV/Excel Dropzone */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-stretch">
          <div className="flex flex-col gap-2 min-w-0">
            {contacts.length > 8 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  aria-label="Filtrar contactos cargados"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder={`Buscar entre ${contacts.length} contacto(s)...`}
                  className={`w-full rounded-xl border pl-8 pr-3 py-1.5 text-xs ${
                    isDark ? 'bg-[#0F1318] border-[#30363D] text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
              </div>
            )}

            <div
              onClick={() => manualInputRef.current?.focus()}
              onScroll={() => setOpenCountryPicker(null)}
              className={`flex-1 rounded-xl border-2 p-2.5 min-h-[124px] max-h-48 overflow-y-auto flex flex-wrap content-start items-center gap-1.5 cursor-text transition-colors focus-within:border-fc-500 ${
                isDark ? 'bg-[#0F1318] border-[#2D333B]' : 'bg-slate-50/70 border-slate-200'
              }`}
            >
              {filteredContacts.slice(0, 150).map((c) => {
                const isInvalid = c.validation === 'invalid' || c.validation === 'blacklisted';
                const isDup = highlightedDuplicates.includes(c.phone);
                const isChecking = c.validation === 'checking';
                const country = getCountryByDial(c.countryDial || '');

                return (
                  <div
                    key={c.phone}
                    className={`relative inline-flex items-center gap-1 pl-1 pr-2 py-1 rounded-lg border text-[11px] font-semibold transition-all ${
                      isDup
                        ? 'bg-amber-100 border-amber-400 text-amber-900 scale-105'
                        : isInvalid
                        ? isDark
                          ? 'bg-rose-950/60 border-rose-500/70 text-rose-200'
                          : 'bg-rose-50 border-rose-300 text-rose-800'
                        : isDark
                        ? 'bg-[#161B22] border-[#30363D] text-slate-100'
                        : 'bg-white border-slate-200 text-slate-800 shadow-2xs'
                    }`}
                  >
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setOpenCountryPicker((cur) =>
                          cur?.phone === c.phone ? null : { phone: c.phone, rect }
                        );
                      }}
                      title={
                        isInvalid
                          ? 'Número no detectado en WhatsApp. Haz clic para cambiar el código de país.'
                          : `País: ${country.name} (+${country.dial || '?'})`
                      }
                      aria-label={`Cambiar código de país para ${c.phone}`}
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md transition-colors ${
                        isInvalid
                          ? 'bg-rose-600 text-white hover:bg-rose-700'
                          : isDark
                          ? 'bg-[#212730] hover:bg-[#2B3340]'
                          : 'bg-slate-100 hover:bg-slate-200'
                      }`}
                    >
                      <span className="text-xs leading-none">{country.flag}</span>
                      <ChevronDown className="w-2.5 h-2.5 opacity-80" />
                    </button>

                    <span className="font-mono tabular-nums">{c.phone}</span>

                    {c.validation === 'valid' && (
                      <CheckCircle2 className="w-3 h-3 text-fc-500 shrink-0" aria-label="Activo en WhatsApp" />
                    )}

                    {isChecking && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}

                    <button
                      type="button"
                      disabled={isSending}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetContacts((prev) => prev.filter((item) => item.phone !== c.phone));
                      }}
                      aria-label={`Quitar ${c.phone}`}
                      className="text-slate-400 hover:text-rose-500 transition-colors ml-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}

              {filteredContacts.length > 150 && (
                <span className={`text-[11px] px-2 py-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  +{filteredContacts.length - 150} más (usa el buscador)
                </span>
              )}

              <input
                ref={manualInputRef}
                type="text"
                aria-label="Ingresar números manualmente"
                disabled={isSending}
                value={manualInput}
                onChange={handleManualInputChange}
                onKeyDown={handleManualInputKeyDown}
                onPaste={handleManualPaste}
                placeholder={
                  contacts.length === 0
                    ? 'Ej: 0991234567, 3055551234, 612345678,'
                    : 'Otro número + coma (,)'
                }
                className={`flex-1 min-w-[160px] bg-transparent text-xs py-1 px-1.5 focus:outline-none ${
                  isDark ? 'text-slate-100 placeholder:text-slate-500' : 'text-slate-900 placeholder:text-slate-400'
                }`}
              />
            </div>

            <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Si un número aparece en rojo, haz clic en su bandera para cambiar el código de país (USA +1 y España +34 arriba) y verificar al instante.
            </p>
          </div>

          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-4 min-h-[124px] h-full flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
              isDragActive
                ? 'border-fc-500 bg-fc-500/10'
                : isDark
                ? 'border-[#2D333B] hover:border-fc-500/60 bg-[#0F1318]'
                : 'border-slate-200 hover:border-fc-500 bg-slate-50/70'
            }`}
          >
            <input {...getInputProps()} aria-label="Cargar archivo Excel o CSV" />
            <FileSpreadsheet className={`w-7 h-7 mb-2 ${isDragActive ? 'text-fc-500' : isDark ? 'text-slate-400' : 'text-slate-500'}`} />
            <p className="text-xs font-semibold">
              {fileName ? `Archivo cargado: ${fileName}` : 'Arrastra tu Excel (.xlsx / .xls) o CSV aquí'}
            </p>
            <p className={`text-[11px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              o haz clic para examinar · detección automática de país y duplicados
            </p>
          </div>
        </div>

        {openCountryPicker && (() => {
          const targetContact = contacts.find((item) => item.phone === openCountryPicker.phone);
          if (!targetContact) return null;
          return (
            <CountryPickerPopover
              anchorRect={openCountryPicker.rect}
              currentDial={targetContact.countryDial}
              isDark={isDark}
              onClose={() => setOpenCountryPicker(null)}
              onSelectCountry={(selected: CountryCodeOption) => {
                const phoneToUpdate = openCountryPicker.phone;
                setOpenCountryPicker(null);
                void onChangeContactCountry(phoneToUpdate, selected.dial);
              }}
            />
          );
        })()}

        {sheetPreview && (
          <div className={`rounded-xl border p-4 space-y-3 ${subSurfaceClass}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold">Mapeo de columnas · {sheetPreview.fileName}</p>
                <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  {sheetPreview.rows.length} fila(s) detectadas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSheetPreview(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
                aria-label="Cancelar importación"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs">
              <label htmlFor="sheet-phone-col" className="block font-semibold mb-1">Columna de Teléfono *</label>
              <select
                id="sheet-phone-col"
                value={sheetPreview.phoneColIndex}
                onChange={(e) =>
                  setSheetPreview((s) => (s ? { ...s, phoneColIndex: Number(e.target.value) } : null))
                }
                className={`w-full rounded-lg border px-2.5 py-2 text-xs ${
                  isDark ? 'bg-[#161B22] border-[#30363D] text-slate-100' : 'bg-white border-slate-200 text-slate-900'
                }`}
              >
                {sheetPreview.headers.map((h, idx) => (
                  <option key={idx} value={idx}>
                    {h} (ej: {sheetPreview.rows[0]?.[idx] || '—'})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSheetPreview(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-200 text-slate-800'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmSheetImport}
                className="px-4 py-1.5 rounded-lg bg-fc-600 hover:bg-fc-700 text-white text-xs font-semibold transition-colors"
              >
                Importar Contactos
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-8 space-y-5">

        {/* Card 2: Message Composer + Scrollable Live Preview */}
        <section className={`rounded-2xl border p-5 space-y-4 ${cardClass}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className={iconBoxClass}>
                <Send className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold">2. Compositor de Mensaje</h2>
                <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Usa variantes Spintax para que cada destinatario reciba un mensaje único
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddTagModal(true)}
                className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${badgeClass}`}
              >
                <Plus className="w-3.5 h-3.5" /> Etiqueta
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {spintaxTags.map((tag, idx) => (
              <div key={`${tag.label}-${idx}`} className="relative group inline-flex">
                <button
                  type="button"
                  onClick={() => insertToken(tag.value)}
                  title={tag.value}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    isDark
                      ? 'bg-[#0F1318] hover:bg-[#1D232C] border-[#2D333B] text-slate-200'
                      : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
                  }`}
                >
                  {tag.label}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteSpintaxTag(idx)}
                  aria-label={`Eliminar etiqueta ${tag.label}`}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shadow-xs"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
            <div className="md:col-span-7 flex flex-col">
              <div className="h-5 flex items-center justify-between mb-1.5 text-[11px]">
                <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  Mensaje base
                </span>
                <span className={`font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Spintax: {'{opción 1|opción 2}'}
                </span>
              </div>
              <textarea
                ref={textAreaRef}
                aria-label="Contenido del mensaje con Spintax"
                value={messageText}
                onChange={(e) => onChangeMessageText(e.target.value)}
                placeholder="Ej: {Hola|Buen día|Saludos}, te compartimos los detalles de nuestro próximo evento..."
                className={`w-full h-60 rounded-xl border p-3.5 text-xs leading-relaxed font-mono resize-none ${
                  isDark
                    ? 'bg-[#0F1318] border-[#2D333B] text-slate-100 placeholder:text-slate-500'
                    : 'bg-slate-50/70 border-slate-200 text-slate-900 placeholder:text-slate-500'
                }`}
              />
              <div className={`mt-1.5 flex justify-end text-[11px] tabular-nums ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                <span>{messageText.length} caracteres</span>
              </div>
            </div>

            {/* Vista Previa Scrolleable alineada al mismo nivel */}
            <div className="md:col-span-5 flex flex-col">
              <div className="h-5 flex items-center justify-between mb-1.5">
                <span className={`text-[11px] font-semibold flex items-center gap-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  <Eye className="w-3.5 h-3.5 text-fc-500" /> Vista Previa Real
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewSeed((s) => s + 1)}
                  className={`text-[11px] font-semibold flex items-center gap-1 hover:underline ${
                    isDark ? 'text-fc-400' : 'text-fc-600'
                  }`}
                >
                  <RefreshCw className="w-3 h-3" /> Variar
                </button>
              </div>

              <div
                className={`h-60 rounded-xl border p-3 overflow-y-auto flex flex-col ${
                  isDark ? 'bg-[#0B141A] border-[#252B33]' : 'bg-[#EFEAE2] border-slate-200'
                }`}
              >
                <div
                  className={`mt-auto rounded-xl rounded-tr-xs p-2.5 shadow-xs text-xs space-y-2 max-w-full ${
                    isDark ? 'bg-[#005C4B] text-slate-100' : 'bg-[#D9FDD3] text-slate-900'
                  }`}
                >
                  {mediaPreview && (
                    mediaType === 'video' ? (
                      <video
                        src={mediaPreview}
                        controls
                        className="w-full max-h-28 rounded-lg bg-black"
                      />
                    ) : (
                      <img
                        src={mediaPreview}
                        alt="Vista previa adjunto"
                        className="w-full max-h-28 object-cover rounded-lg"
                      />
                    )
                  )}
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-[11.5px]">
                    {renderedPreview || (
                      <span className="opacity-70 italic">Escribe un mensaje para previsualizar cómo lo verá el cliente...</span>
                    )}
                  </p>
                  <div className="text-[10px] opacity-70 text-right tabular-nums">
                    09:45 ✓✓
                  </div>
                </div>
              </div>
              <div className={`mt-1.5 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Simulación visual de burbuja en WhatsApp
              </div>
            </div>
          </div>
        </section>

        {/* Card 3: Adjunto Multimedia (Imagen o Video) */}
        <section className={`rounded-2xl border p-5 space-y-3 ${cardClass}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={iconBoxClass}>
                <ImageIcon className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold">3. Adjunto Multimedia (Opcional)</h2>
                <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Adjunta una imagen o video para acompañar cada mensaje de la campaña
                </p>
              </div>
            </div>
            {mediaPreview && (
              <button
                type="button"
                onClick={handleRemoveMedia}
                className="text-xs text-rose-600 dark:text-rose-400 hover:underline font-semibold flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" /> Quitar
              </button>
            )}
          </div>

          {mediaPreview ? (
            <div className={`rounded-xl border p-3 flex items-center gap-4 ${subSurfaceClass}`}>
              {mediaType === 'video' ? (
                <video
                  src={mediaPreview}
                  controls
                  className="w-24 h-20 object-cover rounded-lg border border-black/10 bg-black shrink-0"
                />
              ) : (
                <img
                  src={mediaPreview}
                  alt="Adjunto de campaña"
                  className="w-20 h-20 object-cover rounded-lg border border-black/10 shrink-0"
                />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs font-bold truncate">
                  {mediaName || (mediaType === 'video' ? 'Video listo para envío' : 'Imagen lista para envío')}
                </p>
                <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  {mediaType === 'video'
                    ? 'Video adjunto configurado para la campaña.'
                    : 'Imagen lista para enviarse junto al texto.'}
                </p>
              </div>
            </div>
          ) : (
            <div>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*,video/mp4,video/quicktime,video/webm"
                onChange={handleMediaUpload}
                className="hidden"
                aria-label="Seleccionar imagen o video adjunto"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`w-full py-3.5 px-4 border-2 border-dashed rounded-xl text-xs font-semibold transition-colors ${
                  isDark
                    ? 'border-[#2D333B] hover:border-fc-500/60 bg-[#0F1318] text-slate-300'
                    : 'border-slate-200 hover:border-fc-500 bg-slate-50/70 text-slate-700'
                }`}
              >
                + Seleccionar Imagen o Video (PNG, JPG, WebP, MP4, MOV)
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Right Column: Execution & Telemetry (4 cols) */}
      <div className="lg:col-span-4 space-y-5 lg:sticky lg:top-0">
        <section className={`rounded-2xl border p-5 space-y-5 ${cardClass}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold">Control de Ejecución</h2>
              <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Cadencia humana y salvaguardas activas
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenProtectionTab}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors ${badgeClass}`}
            >
              <Shield className="w-3 h-3" /> Escudos
            </button>
          </div>

          {hasLowVariationRisk && (
            <div
              className={`p-3 rounded-xl border text-[11px] flex items-start gap-2 ${
                isDark
                  ? 'bg-amber-500/10 border-amber-500/35 text-amber-200'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <span>
                Mensaje estático para {contacts.length} contactos. Agrega variaciones <strong>{'{a|b}'}</strong> para evitar filtros de mensajes idénticos.
              </span>
            </div>
          )}

          {/* Sliders (Default 30s - 120s) */}
          <div className="space-y-4 text-xs">
            <div>
              <div className="flex justify-between mb-1.5">
                <label htmlFor="min-delay-slider" className="font-medium">Pausa mínima entre mensajes</label>
                <span className={`font-bold tabular-nums ${isDark ? 'text-fc-400' : 'text-fc-600'}`}>{minDelay} seg</span>
              </div>
              <input
                id="min-delay-slider"
                type="range"
                min={10}
                max={120}
                value={minDelay}
                disabled={isSending}
                onChange={(e) => handleMinDelayChange(Number(e.target.value))}
                className="w-full accent-fc-500"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1.5">
                <label htmlFor="max-delay-slider" className="font-medium">Pausa máxima entre mensajes</label>
                <span className={`font-bold tabular-nums ${isDark ? 'text-fc-400' : 'text-fc-600'}`}>{maxDelay} seg</span>
              </div>
              <input
                id="max-delay-slider"
                type="range"
                min={minDelay}
                max={300}
                value={maxDelay}
                disabled={isSending}
                onChange={(e) => handleMaxDelayChange(Number(e.target.value))}
                className="w-full accent-fc-500"
              />
            </div>
          </div>

          <div className={`rounded-xl border p-3 text-[11px] space-y-1 ${subSurfaceClass}`}>
            <div className="flex justify-between">
              <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>Tope por minuto:</span>
              <span className="font-bold tabular-nums">{settings.safety.maxPerMinute} msg/min</span>
            </div>
            <div className="flex justify-between">
              <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>Descanso por lotes:</span>
              <span className="font-bold tabular-nums">
                {settings.safety.batchSize > 0
                  ? `Cada ${settings.safety.batchSize} (${settings.safety.restMinutes}m)`
                  : 'Desactivado'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>Duración estimada:</span>
              <span className="font-bold tabular-nums">
                {estimatedTotalSec > 0 ? `~${formatCountdown(estimatedTotalSec)}` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>Reporte al finalizar:</span>
              <span className="font-bold">WhatsApp + Excel automático</span>
            </div>
          </div>

          {(isSending || bulkProgress.total > 0) && (
            <div className={`rounded-xl border p-3.5 space-y-3 ${subSurfaceClass}`}>
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="font-bold">
                  {isSending ? 'Campaña en ejecución' : 'Última ronda'}
                </span>
                <div className="flex items-center gap-2 tabular-nums">
                  {isSending && liveEtaSec !== null && (
                    <span
                      className={`px-2 py-0.5 rounded-md font-bold text-[11px] ${
                        isDark ? 'bg-fc-500/15 text-fc-300' : 'bg-fc-50 text-fc-700 border border-fc-200'
                      }`}
                    >
                      ETA {formatCountdown(liveEtaSec)}
                    </span>
                  )}
                  <span className={`font-bold ${isDark ? 'text-fc-400' : 'text-fc-600'}`}>
                    {bulkProgress.processed}/{bulkProgress.total} ({progressPct}%)
                  </span>
                </div>
              </div>

              <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                <div
                  className="h-full bg-fc-500 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className={`rounded-lg p-2 border ${isDark ? 'bg-[#161B22] border-[#252B33]' : 'bg-white border-slate-200'}`}>
                  <p className={`text-[10px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Exitosos</p>
                  <p className={`text-sm font-extrabold tabular-nums ${isDark ? 'text-fc-400' : 'text-fc-600'}`}>
                    {bulkProgress.successCount}
                  </p>
                </div>
                <div className={`rounded-lg p-2 border ${isDark ? 'bg-[#161B22] border-[#252B33]' : 'bg-white border-slate-200'}`}>
                  <p className={`text-[10px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Fallidos</p>
                  <p className="text-sm font-extrabold text-rose-600 dark:text-rose-400 tabular-nums">
                    {bulkProgress.errorCount}
                  </p>
                </div>
                <div className={`rounded-lg p-2 border ${isDark ? 'bg-[#161B22] border-[#252B33]' : 'bg-white border-slate-200'}`}>
                  <p className={`text-[10px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Omitidos</p>
                  <p className="text-sm font-extrabold text-amber-700 dark:text-amber-400 tabular-nums">
                    {bulkProgress.skippedCount}
                  </p>
                </div>
              </div>

              {isSending && activeDelay && (
                <div
                  className={`rounded-lg border p-2.5 space-y-1.5 ${
                    isDark ? 'bg-[#161B22] border-[#252B33]' : 'bg-white border-amber-200/80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-amber-700 dark:text-amber-300 font-semibold">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Clock className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                      <span className="truncate">{activeDelay.reason}</span>
                    </div>
                    <span className="font-mono font-bold tabular-nums shrink-0">
                      {liveStepTotalSec >= 60 ? formatCountdown(liveStepRemainingSec) : `${liveStepRemainingSec}s`}
                    </span>
                  </div>
                  <div className={`h-1 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-amber-100'}`}>
                    <div
                      className="h-full bg-amber-500 transition-all duration-200"
                      style={{ width: `${liveStepPct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {isSending && (
            <div>
              <button
                type="button"
                onClick={onStopSend}
                className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider shadow-sm transition-all flex items-center justify-center gap-2"
              >
                <Square className="w-3.5 h-3.5 fill-white" />
                Detener Inmediatamente ({bulkProgress.queued} restantes)
              </button>
            </div>
          )}
        </section>

        <AnimatePresence>
          {lastFinishReport && !isSending && (
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className={`rounded-2xl border p-4 space-y-3 ${
                lastFinishReport.circuitBreakerTripped
                  ? isDark
                    ? 'bg-rose-950/35 border-rose-500/40'
                    : 'bg-rose-50 border-rose-200'
                  : isDark
                  ? 'bg-fc-500/12 border-fc-500/35'
                  : 'bg-fc-50 border-fc-200'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2
                    className={`w-5 h-5 shrink-0 ${
                      lastFinishReport.circuitBreakerTripped
                        ? 'text-rose-500'
                        : isDark
                        ? 'text-fc-400'
                        : 'text-fc-600'
                    }`}
                  />
                  <div>
                    <h3 className="text-xs font-bold">
                      {lastFinishReport.circuitBreakerTripped ? 'Campaña pausada por protección' : 'Campaña finalizada'}
                    </h3>
                    <p className={`text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      Duración total: <strong className="tabular-nums">{lastFinishReport.timeStr}</strong> · Reporte enviado a tu WhatsApp
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onDismissFinishReport}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700"
                  aria-label="Cerrar resumen"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-3 text-xs font-semibold tabular-nums">
                  <span className={isDark ? 'text-fc-400' : 'text-fc-600'}>Exitosos: {lastFinishReport.successCount}</span>
                  <span className="text-rose-600 dark:text-rose-400">Fallidos: {lastFinishReport.errorCount}</span>
                  <span className="text-amber-700 dark:text-amber-300">Omitidos: {lastFinishReport.skippedCount}</span>
                </div>

                {lastFinishReport.reportExcelPath && (
                  <button
                    type="button"
                    onClick={() => onOpenReportFile(lastFinishReport.reportExcelPath!)}
                    className="px-3 py-1.5 rounded-lg bg-fc-600 hover:bg-fc-700 text-white text-[11px] font-bold flex items-center gap-1.5 transition-colors"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" /> Abrir Excel Resumen
                  </button>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
      </div>

      {/* Add Spintax Tag Modal */}
      <AnimatePresence>
        {showAddTagModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="spintax-modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/55 backdrop-blur-[2px]"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className={`rounded-2xl border p-5 max-w-sm w-full shadow-2xl space-y-4 ${cardClass}`}
            >
              <div className="flex items-center justify-between">
                <h3 id="spintax-modal-title" className="text-sm font-bold">Nueva Etiqueta Spintax</h3>
                <button
                  type="button"
                  onClick={() => setShowAddTagModal(false)}
                  aria-label="Cerrar modal"
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label htmlFor="tag-label-input" className="font-semibold block mb-1">Nombre del Botón</label>
                  <input
                    id="tag-label-input"
                    ref={tagLabelInputRef}
                    type="text"
                    value={newTagLabel}
                    onChange={(e) => setNewTagLabel(e.target.value)}
                    placeholder="Ej: Descuento"
                    className={`w-full rounded-xl border px-3 py-2 ${
                      isDark ? 'bg-[#0F1318] border-[#30363D]' : 'bg-slate-50 border-slate-200'
                    }`}
                  />
                </div>
                <div>
                  <label htmlFor="tag-value-input" className="font-semibold block mb-1">Opciones separadas por |</label>
                  <input
                    id="tag-value-input"
                    type="text"
                    value={newTagValue}
                    onChange={(e) => setNewTagValue(e.target.value)}
                    placeholder="Ej: 10% de descuento|Beneficio exclusivo"
                    className={`w-full rounded-xl border px-3 py-2 ${
                      isDark ? 'bg-[#0F1318] border-[#30363D]' : 'bg-slate-50 border-slate-200'
                    }`}
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddTagModal(false)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold ${
                    isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreateTag}
                  className="px-4 py-2 rounded-xl bg-fc-600 hover:bg-fc-700 text-white text-xs font-bold"
                >
                  Guardar Etiqueta
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
