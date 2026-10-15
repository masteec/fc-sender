import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import {
  QrCode, Loader2, CheckCircle, FileSpreadsheet,
  Image as ImageIcon, Send, X, AlertCircle, Play, SquareSquare, Plus,
  ShieldCheck, RefreshCw, LogOut, Check, Sparkles, PhoneCall,
  Ban, Download, Trash2, UserX, Video, AlertTriangle
} from 'lucide-react';

export interface WhatsAppUser {
  id: string;
  phone: string;
  name?: string;
}

export interface WhatsAppStatus {
  status: 'DISCONNECTED' | 'CONNECTING' | 'READY';
  qr?: string;
  error?: string;
  message?: string;
  user?: WhatsAppUser;
}

export interface SendTask {
  number: string;
  text: string;
  imagePath?: string;
  mediaPath?: string;
  mediaType?: 'image' | 'video';
}

export interface NumberStatus {
  [number: string]: 'valid' | 'invalid' | 'unknown';
}

export interface BlacklistEntry {
  phone: string;
  reason: 'opt_out' | 'manual' | 'reported';
  timestamp: string;
  triggerKeyword?: string;
}

export interface DeliveryRecord {
  number: string;
  status: 'success' | 'error';
  error?: string;
  time: string;
}

declare global {
  interface Window {
    electronAPI: {
      onWhatsAppStatus: (callback: (data: WhatsAppStatus) => void) => () => void;
      getWhatsAppStatus: () => void;
      logoutWhatsApp: () => Promise<boolean>;
      getPathForFile?: (file: File) => string;
      saveTempMedia?: (fileName: string, buffer: ArrayBuffer) => Promise<string>;
      validateNumbers: (numbers: string[]) => Promise<{
        results: Array<{ number: string; exists: boolean; jid?: string }>;
        validCount: number;
        invalidCount: number;
      }>;
      getBlacklist: () => Promise<BlacklistEntry[]>;
      addToBlacklist: (phone: string, reason?: string) => Promise<boolean>;
      removeFromBlacklist: (phone: string) => Promise<boolean>;
      clearBlacklist: () => Promise<boolean>;
      onBlacklistUpdated: (callback: (data: BlacklistEntry[]) => void) => () => void;
      startBulkSend: (
        tasks: SendTask[],
        config: {
          batchSize: number;
          restMinutes: number;
          minDelay: number;
          maxDelay: number;
          autoValidate?: boolean;
          includeOptOut?: boolean;
          optOutText?: string;
          videoMutationMode?: 'fast' | 'deep';
        }
      ) => void;
      stopBulkSend: () => void;
      onBulkSenderUpdate: (callback: (data: { queued: number; isSending: boolean }) => void) => () => void;
      onBulkSenderProgress: (callback: (data: { status: string; number: string; error?: string }) => void) => () => void;
      onBulkSenderDelay: (callback: (data: { delay: number }) => void) => () => void;
      onBulkSenderLog: (callback: (data: { msg: string; type: 'info' | 'success' | 'error' }) => void) => () => void;
      onBulkSenderFinish: (callback: (data: {
        successCount: number;
        errorCount: number;
        filteredCount?: number;
        blacklistedCount?: number;
        timeStr: string;
        successRate?: number;
      }) => void) => () => void;
    };
  }
}

const SPINTAX_TAGS = [
  { label: 'Saludo', value: '{Hola|Buen día|Hola, ¿cómo estás?|Saludos|Qué tal}' },
  { label: 'Introducción', value: '{Te escribo para contarte que|Paso por aquí para compartirte que|Queríamos hacerte llegar|Aprovecho para comentarte que}' },
  { label: 'Novedad / Info', value: '{tenemos una novedad especial|preparamos una información importante|queremos mostrarte nuestra propuesta|tenemos información de tu interés}' },
  { label: 'Llamado a la acción', value: '{¿Te gustaría conocer más detalles?|Si te interesa, escríbeme por aquí.|Avísame si deseas que coordinemos.|Déjanos saber tu respuesta si deseas más info.}' },
  { label: 'Despedida', value: '{¡Que tengas un excelente día!|¡Un saludo cordial!|¡Hablamos pronto!|¡Muchos éxitos!}' },
];

const ACCEPTED_FILE_TYPES = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv']
};

function App() {
  const [waStatus, setWaStatus] = useState<WhatsAppStatus>({ status: 'CONNECTING', message: 'Iniciando Evolution Engine...' });

  const [messageText, setMessageText] = useState(() => localStorage.getItem('ws_msg') || '');
  const [numbers, setNumbers] = useState<string[]>(() => JSON.parse(localStorage.getItem('ws_nums') || '[]'));
  const [numberStatuses, setNumberStatuses] = useState<NumberStatus>({});
  const [isValidating, setIsValidating] = useState(false);

  // Blacklist state
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [showBlacklistModal, setShowBlacklistModal] = useState(false);
  const [manualBlacklistInput, setManualBlacklistInput] = useState('');
  const [includeOptOut, setIncludeOptOut] = useState<boolean>(() => localStorage.getItem('ws_optout') !== 'false');
  const [optOutText, setOptOutText] = useState<string>(() => localStorage.getItem('ws_optout_txt') || '\n\n_Si quieres dejar de recibir promociones, responde "SALIR"_');

  const [manualInput, setManualInput] = useState('');
  const [fileName, setFileName] = useState('');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');

  const [mediaPath, setMediaPath] = useState(() => {
    const p = localStorage.getItem('ws_imgPath') || '';
    return p.startsWith('blob:') ? '' : p;
  });
  const [mediaPreview, setMediaPreview] = useState(() => {
    const p = localStorage.getItem('ws_imgPrev') || '';
    return p.startsWith('blob:') ? '' : p;
  });
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(() => {
    const p = localStorage.getItem('ws_imgPath') || '';
    if (p.startsWith('blob:')) return null;
    if (/\.(mp4|mov|m4v|3gp|mkv|webm)$/i.test(p)) return 'video';
    if (p) return 'image';
    return null;
  });
  const [mediaSizeMB, setMediaSizeMB] = useState<number | null>(null);
  const [videoMutationMode, setVideoMutationMode] = useState<'fast' | 'deep'>(() =>
    (localStorage.getItem('ws_vmm') as 'fast' | 'deep') || 'fast'
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Bulk Sender State
  const [isSending, setIsSending] = useState(false);
  const [queued, setQueued] = useState(0);
  const [logs, setLogs] = useState<{ time: string; msg: string; type: 'info' | 'success' | 'error' }[]>([]);
  const [deliveryRecords, setDeliveryRecords] = useState<DeliveryRecord[]>([]);
  const [delayCountdown, setDelayCountdown] = useState<number | null>(null);
  const [showContacts, setShowContacts] = useState(true);
  const [highlightedNumbers, setHighlightedNumbers] = useState<string[]>([]);
  const [invalidNumbers, setInvalidNumbers] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState<number>(() => Number(localStorage.getItem('ws_batch')) || 25);
  const [restMinutes, setRestMinutes] = useState<number>(() => Number(localStorage.getItem('ws_rest')) || 5);
  const [minDelay, setMinDelay] = useState<number>(() => Number(localStorage.getItem('ws_minD')) || 15);
  const [maxDelay, setMaxDelay] = useState<number>(() => Number(localStorage.getItem('ws_maxD')) || 45);
  const [finishReport, setFinishReport] = useState<{
    successCount: number;
    errorCount: number;
    filteredCount?: number;
    blacklistedCount?: number;
    timeStr: string;
    successRate?: number;
  } | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Guardado en almacenamiento local
  useEffect(() => {
    localStorage.setItem('ws_msg', messageText);
    localStorage.setItem('ws_nums', JSON.stringify(numbers));
    localStorage.setItem('ws_batch', batchSize.toString());
    localStorage.setItem('ws_rest', restMinutes.toString());
    localStorage.setItem('ws_minD', minDelay.toString());
    localStorage.setItem('ws_maxD', maxDelay.toString());
    localStorage.setItem('ws_imgPath', mediaPath);
    localStorage.setItem('ws_vmm', videoMutationMode);
    localStorage.setItem('ws_optout', includeOptOut.toString());
    localStorage.setItem('ws_optout_txt', optOutText);
    try {
      if (mediaPreview && mediaType === 'image') localStorage.setItem('ws_imgPrev', mediaPreview);
      else localStorage.removeItem('ws_imgPrev');
    } catch {
      // Ignorar si la imagen supera la cuota
    }
  }, [messageText, numbers, batchSize, restMinutes, minDelay, maxDelay, mediaPath, mediaPreview, mediaType, videoMutationMode, includeOptOut, optOutText]);

  // Cargar Blacklist inicial
  const refreshBlacklist = useCallback(async () => {
    if (window.electronAPI?.getBlacklist) {
      try {
        const list = await window.electronAPI.getBlacklist();
        setBlacklist(list);
      } catch (err) {
        console.error('Error al cargar blacklist:', err);
      }
    }
  }, []);

  useEffect(() => {
    refreshBlacklist();

    const cleanupStatus = window.electronAPI?.onWhatsAppStatus((data) => {
      setWaStatus(data);
      setIsInitializing(false);
    });

    const cleanupBlacklist = window.electronAPI?.onBlacklistUpdated((updatedList) => {
      setBlacklist(updatedList);
    });

    const cleanupUpdate = window.electronAPI?.onBulkSenderUpdate(({ queued, isSending }) => {
      setQueued(queued);
      setIsSending(isSending);
    });

    const cleanupProgress = window.electronAPI?.onBulkSenderProgress(({ status, number, error }) => {
      const time = new Date().toLocaleTimeString();
      setDeliveryRecords(prev => [{ number, status: status as any, error, time }, ...prev]);

      if (status === 'success') {
        setLogs(prev => [{ time, msg: `Entregado a ${number}`, type: 'success' as const }, ...prev].slice(0, 60));
        setNumberStatuses(prev => ({ ...prev, [number.replace(/\D/g, '')]: 'valid' }));
      } else {
        setLogs(prev => [{ time, msg: `Fallo en ${number}: ${error}`, type: 'error' as const }, ...prev].slice(0, 60));
        const clean = number.replace(/\D/g, '');
        setNumberStatuses(prev => ({ ...prev, [clean]: 'invalid' }));
        setInvalidNumbers(prev => (prev.includes(number) ? prev : [...prev, number]));
      }
    });

    const cleanupLog = window.electronAPI?.onBulkSenderLog(({ msg, type }) => {
      const time = new Date().toLocaleTimeString();
      setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 60));
    });

    const cleanupDelay = window.electronAPI?.onBulkSenderDelay(({ delay }) => {
      setDelayCountdown(Math.ceil(delay / 1000));
    });

    const cleanupFinish = window.electronAPI?.onBulkSenderFinish((data) => {
      setFinishReport(data);
    });

    window.electronAPI?.getWhatsAppStatus?.();

    const fallbackTimer = setTimeout(() => {
      setIsInitializing(false);
    }, 2000);

    return () => {
      clearTimeout(fallbackTimer);
      if (cleanupStatus) cleanupStatus();
      if (cleanupBlacklist) cleanupBlacklist();
      if (cleanupUpdate) cleanupUpdate();
      if (cleanupProgress) cleanupProgress();
      if (cleanupLog) cleanupLog();
      if (cleanupDelay) cleanupDelay();
      if (cleanupFinish) cleanupFinish();
    };
  }, [refreshBlacklist]);

  useEffect(() => {
    let interval: any;
    if (delayCountdown !== null && delayCountdown > 0) {
      interval = setInterval(() => setDelayCountdown(d => (d && d > 0 ? d - 1 : 0)), 1000);
    } else if (delayCountdown === 0) {
      setDelayCountdown(null);
    }
    return () => clearInterval(interval);
  }, [delayCountdown]);

  const handleRemoveNumber = useCallback((numToRemove: string) => {
    setNumbers(prev => prev.filter(n => n !== numToRemove));
    const clean = numToRemove.replace(/\D/g, '');
    setNumberStatuses(prev => {
      const copy = { ...prev };
      delete copy[clean];
      return copy;
    });
  }, []);

  const processAndAddNumbers = useCallback((input: string, source: 'manual' | 'file') => {
    // Dividir por saltos de línea, comas, punto y coma o tabuladores (preservando espacios internos en números como '098 561 1627')
    const rawTokens = input.split(/[\r\n,;\t]+/);
    const candidateList: string[] = [];

    rawTokens.forEach(token => {
      const trimmed = token.trim();
      if (!trimmed) return;

      // Si el usuario ingresó múltiples números separados por espacios (ej: "0985611627 0991234567")
      const spaceParts = trimmed.split(/\s+/);
      const isMultipleIndependentNumbers = spaceParts.length > 1 && spaceParts.every(p => p.replace(/\D/g, '').length >= 8);

      if (isMultipleIndependentNumbers) {
        spaceParts.forEach(p => candidateList.push(p));
      } else {
        // Es un único número con espacios internos (ej: "098 561 1627" -> se mantiene como un solo número)
        candidateList.push(trimmed);
      }
    });

    const processed = candidateList.map(n => {
      const clean = n.replace(/\D/g, '');
      if (!clean || clean.length < 8) return null;

      if (clean.startsWith('09') && clean.length === 10) {
        return '+593' + clean.substring(1);
      } else if (clean.startsWith('9') && clean.length === 9) {
        return '+593' + clean;
      } else if (clean.startsWith('593') && clean.length === 12) {
        return '+' + clean;
      } else if (clean.startsWith('1') && clean.length === 11) {
        return '+' + clean;
      } else if (clean.length === 10) {
        return '+1' + clean;
      }
      return '+' + clean;
    }).filter(Boolean) as string[];

    if (processed.length > 0) {
      setNumbers(prev => {
        const newNumbers = [...prev];
        const duplicates: string[] = [];
        processed.forEach(p => {
          if (newNumbers.includes(p)) duplicates.push(p);
          else newNumbers.push(p);
        });

        if (duplicates.length > 0) {
          setHighlightedNumbers(duplicates);
          setTimeout(() => setHighlightedNumbers([]), 1500);
        }

        return newNumbers;
      });

      const time = new Date().toLocaleTimeString();
      const msgStr = source === 'manual'
        ? `Se agregaron ${processed.length} números manualmente`
        : `Se cargaron ${processed.length} números de ${fileName || 'archivo'}`;
      setLogs(prev => [{ time, msg: msgStr, type: 'success' as const }, ...prev].slice(0, 60));
    }
  }, [fileName]);

  const handleValidateNumbers = async () => {
    if (numbers.length === 0) return;
    if (waStatus.status !== 'READY') {
      alert('Debes vincular WhatsApp antes de validar los números.');
      return;
    }

    setIsValidating(true);
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [{ time, msg: `Iniciando verificación en tiempo real de ${numbers.length} números en WhatsApp...`, type: 'info' }, ...prev]);

    try {
      const response = await window.electronAPI.validateNumbers(numbers);
      const newStatuses: NumberStatus = {};
      const newInvalids: string[] = [];

      response.results.forEach(r => {
        newStatuses[r.number] = r.exists ? 'valid' : 'invalid';
        if (!r.exists) {
          const matched = numbers.find(n => n.replace(/\D/g, '') === r.number);
          if (matched) newInvalids.push(matched);
        }
      });

      setNumberStatuses(prev => ({ ...prev, ...newStatuses }));
      setInvalidNumbers(newInvalids);

      const endTime = new Date().toLocaleTimeString();
      setLogs(prev => [
        {
          time: endTime,
          msg: `Verificación finalizada: ${response.validCount} registrados en WhatsApp, ${response.invalidCount} no registrados.`,
          type: response.invalidCount > 0 ? 'info' : 'success'
        },
        ...prev
      ]);
    } catch (err: any) {
      setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg: `Error en validación: ${err.message}`, type: 'error' }, ...prev]);
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemoveInvalidNumbers = () => {
    if (invalidNumbers.length === 0) return;
    setNumbers(prev => prev.filter(n => !invalidNumbers.includes(n)));
    setInvalidNumbers([]);
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [{ time, msg: 'Se removieron todos los números no registrados.', type: 'info' }, ...prev]);
  };

  const handleManualInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.includes(',') || val.includes('\n')) {
      processAndAddNumbers(val, 'manual');
      setManualInput('');
    } else {
      setManualInput(val);
    }
  };

  const handleManualInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (manualInput.trim()) {
        processAndAddNumbers(manualInput, 'manual');
        setManualInput('');
      }
    } else if (e.key === 'Backspace' && manualInput === '' && numbers.length > 0 && showContacts) {
      const newNumbers = [...numbers];
      newNumbers.pop();
      setNumbers(newNumbers);
    }
  };

  const addManualButton = () => {
    if (manualInput.trim()) {
      processAndAddNumbers(manualInput, 'manual');
      setManualInput('');
    }
  };

  const processSheet = useCallback((wb: XLSX.WorkBook, sheetName: string) => {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    const extractedNumbers: string[] = [];
    rows.forEach(row => {
      row.forEach(cell => {
        if (cell === null || cell === undefined) return;
        const rawStr = String(cell).trim();
        if (!rawStr) return;

        // Si la celda contiene saltos de línea con múltiples números, procesar cada línea
        const lines = rawStr.split(/[\r\n,;]+/);
        lines.forEach(line => {
          const trimmed = line.trim();
          if (!trimmed) return;
          // Si la celda contiene un número con espacios internos (ej: '098 561 1627' o '+593 98 561 1627')
          const digits = trimmed.replace(/\D/g, '');
          if (digits.length >= 8 && digits.length <= 16) {
            extractedNumbers.push(trimmed.startsWith('+') ? '+' + digits : digits);
          }
        });
      });
    });

    processAndAddNumbers(extractedNumbers.join('\n'), 'file');
  }, [processAndAddNumbers]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });

        setWorkbook(wb);
        setSheetNames(wb.SheetNames);

        if (wb.SheetNames.length === 1) {
          setSelectedSheet(wb.SheetNames[0]);
          processSheet(wb, wb.SheetNames[0]);
        } else {
          setSelectedSheet('');
        }
      } catch {
        alert('Error al leer el archivo Excel/CSV.');
      }
    };
    reader.readAsArrayBuffer(file);
  }, [processSheet]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    multiple: false
  });

  const handleMediaChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0] as any;
      let filePath = '';

      // 1. Obtener la ruta real del sistema de archivos mediante webUtils (Electron 28+)
      if (window.electronAPI?.getPathForFile) {
        try {
          filePath = window.electronAPI.getPathForFile(file) || '';
        } catch (err) {
          console.warn('Error en getPathForFile:', err);
        }
      }

      // 2. Fallback a propiedad path de DOM File si estuviera disponible
      if (!filePath && file.path && !file.path.startsWith('blob:')) {
        filePath = file.path;
      }

      // 3. Fallback de persistencia en disco temporal vía IPC si no hay ruta directa accesible
      if (!filePath && window.electronAPI?.saveTempMedia) {
        try {
          const buf = await file.arrayBuffer();
          filePath = await window.electronAPI.saveTempMedia(file.name || 'comunicado_adjunto', buf);
        } catch (saveErr) {
          console.error('Error al persistir medio en archivo temporal:', saveErr);
        }
      }

      const sizeMB = Number((file.size / (1024 * 1024)).toFixed(2));
      setMediaSizeMB(sizeMB);
      setMediaPath(filePath);

      const isVid = file.type?.startsWith('video/') || /\.(mp4|mov|m4v|3gp|mkv|webm)$/i.test(file.name || filePath);
      setMediaType(isVid ? 'video' : 'image');

      if (isVid) {
        const url = URL.createObjectURL(file);
        setMediaPreview(url);
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setMediaPreview(ev.target?.result as string);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const removeMedia = () => {
    setMediaPath('');
    setMediaPreview('');
    setMediaType(null);
    setMediaSizeMB(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const insertSpintax = (spintax: string) => {
    if (textAreaRef.current) {
      const start = textAreaRef.current.selectionStart;
      const end = textAreaRef.current.selectionEnd;
      const newText = messageText.substring(0, start) + spintax + messageText.substring(end);
      setMessageText(newText);
      setTimeout(() => {
        if (textAreaRef.current) {
          textAreaRef.current.focus();
          textAreaRef.current.selectionStart = start + spintax.length;
          textAreaRef.current.selectionEnd = start + spintax.length;
        }
      }, 0);
    } else {
      setMessageText(messageText + spintax);
    }
  };

  const handleStartSend = () => {
    if (numbers.length === 0) {
      alert('Carga o ingresa al menos un número.');
      return;
    }
    if (!messageText) {
      alert('Escribe un mensaje para enviar.');
      return;
    }

    // Ruta de sistema de archivos real (garantizando que nunca sea una URL blob: o data:)
    const cleanMediaPath = mediaPath && !mediaPath.startsWith('blob:') && !mediaPath.startsWith('data:')
      ? mediaPath
      : undefined;

    // Para imágenes, si no hay ruta en disco, permitir el dataURL (base64) del preview
    const cleanImagePath = mediaType === 'image'
      ? (cleanMediaPath || (mediaPreview && !mediaPreview.startsWith('blob:') ? mediaPreview : undefined))
      : undefined;

    if (mediaType === 'video' && !cleanMediaPath) {
      alert('No se pudo identificar la ruta en disco del archivo de video. Por favor, vuelve a seleccionar el video haciendo clic en la sección de adjunto.');
      return;
    }

    setInvalidNumbers([]);
    setDeliveryRecords([]);
    const tasks: SendTask[] = numbers.map(number => ({
      number: number.replace(/\D/g, ''),
      text: messageText,
      imagePath: cleanImagePath,
      mediaPath: cleanMediaPath,
      mediaType: mediaType || undefined
    }));

    window.electronAPI.startBulkSend(tasks, {
      batchSize,
      restMinutes,
      minDelay,
      maxDelay,
      autoValidate: true,
      includeOptOut,
      optOutText: includeOptOut ? optOutText : '',
      videoMutationMode
    });
  };

  const handleStopSend = () => {
    window.electronAPI.stopBulkSend();
  };

  const handleLogout = async () => {
    if (confirm('¿Deseas desvincular esta cuenta de WhatsApp? Se generará un nuevo código QR.')) {
      await window.electronAPI.logoutWhatsApp();
    }
  };

  // Blacklist Management Handlers
  const handleAddToBlacklist = async () => {
    if (!manualBlacklistInput.trim()) return;
    const clean = manualBlacklistInput.replace(/\D/g, '');
    if (!clean || clean.length < 8) {
      alert('Ingresa un número telefónico válido con código de país.');
      return;
    }
    await window.electronAPI.addToBlacklist(clean, 'manual');
    setManualBlacklistInput('');
  };

  const handleRemoveFromBlacklist = async (phone: string) => {
    await window.electronAPI.removeFromBlacklist(phone);
  };

  const handleClearBlacklist = async () => {
    if (confirm('¿Estás seguro de vaciar toda la lista negra? Los usuarios desuscritos volverán a recibir mensajes si son incluidos en una base.')) {
      await window.electronAPI.clearBlacklist();
    }
  };

  // Exportar reporte de campaña a Excel
  const exportReportToExcel = () => {
    if (deliveryRecords.length === 0 && !finishReport) {
      alert('No hay registros de envío para exportar.');
      return;
    }

    const data = deliveryRecords.map((rec, index) => ({
      '#': index + 1,
      'Destinatario': '+' + rec.number,
      'Estado': rec.status === 'success' ? 'ENTREGADO' : 'FALLIDO',
      'Detalle / Error': rec.error || 'Mensaje despachado con éxito',
      'Hora': rec.time
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reporte de Envíos');

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Reporte_FCSender_${dateStr}.xlsx`);
  };

  const getETA = () => {
    if (!isSending || queued === 0) return null;

    const avgDelay = (minDelay + maxDelay) / 2;
    let totalSeconds = queued * (avgDelay + 8);
    if (batchSize > 0 && restMinutes > 0) {
      const batchesLeft = Math.floor(queued / batchSize);
      totalSeconds += batchesLeft * restMinutes * 60;
    }

    if (totalSeconds < 60) return `${Math.ceil(totalSeconds)}s`;
    const mins = Math.floor(totalSeconds / 60);
    const hrs = Math.floor(mins / 60);
    return hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
  };

  const totalNumbers = numbers.length;
  const verifiedValid = Object.values(numberStatuses).filter(s => s === 'valid').length;
  const verifiedInvalid = Object.values(numberStatuses).filter(s => s === 'invalid').length;
  const reputationPercentage = totalNumbers > 0 && (verifiedValid + verifiedInvalid > 0)
    ? Math.round((verifiedValid / (verifiedValid + verifiedInvalid)) * 100)
    : 100;

  if (isInitializing) {
    return (
      <div className="flex h-screen bg-slate-50 font-sans overflow-hidden items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
          <p className="text-slate-600 font-medium">Iniciando FCSender Evolution Engine...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      
      {/* Columna Izquierda: Configuración y Base */}
      <div className="w-[55%] border-r border-slate-200 bg-white flex flex-col shadow-sm z-10 relative">

        {/* Modal de vinculación QR */}
        <AnimatePresence>
          {waStatus.status !== 'READY' && (
            <motion.div
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-white/95 backdrop-blur-md z-50 flex flex-col items-center justify-center p-8 text-center"
            >
              {waStatus.status === 'DISCONNECTED' && waStatus.qr ? (
                <div className="bg-white p-8 rounded-3xl shadow-2xl border border-slate-100 flex flex-col items-center max-w-md">
                  <div className="bg-slate-50 p-4 rounded-2xl mb-5 shadow-inner border border-slate-100">
                    <img src={waStatus.qr} alt="WhatsApp QR" className="w-64 h-64" />
                  </div>
                  <h2 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">Vincular Cuenta Oficial</h2>
                  <p className="text-slate-500 text-sm max-w-sm mb-5">
                    Abre WhatsApp en tu teléfono, ve a <strong>Dispositivos vinculados</strong> y escanea el código para conectar con el motor Evolution.
                  </p>
                  <div className="flex items-center gap-2 text-indigo-600 bg-indigo-50 px-4 py-2 rounded-full font-semibold text-xs border border-indigo-100">
                    <QrCode className="w-4 h-4" /> Conexión Directa WebSocket (Sin Navegador)
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
                    <Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-800 mb-1">Iniciando Túnel WhatsApp...</h2>
                  <p className="text-slate-500 text-sm max-w-xs">{waStatus.message || 'Sincronizando claves de cifrado...'}</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modal de Lista Negra / Opt-Out */}
        <AnimatePresence>
          {showBlacklistModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-6"
            >
              <motion.div
                initial={{ scale: 0.95, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 20 }}
                className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]"
              >
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-rose-100 text-rose-700 rounded-xl flex items-center justify-center">
                      <Ban className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm text-slate-900">Lista Negra & Bajas (Opt-Out)</h3>
                      <p className="text-[11px] text-slate-500">{blacklist.length} contactos protegidos contra envíos</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowBlacklistModal(false)}
                    className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-6 flex-1 overflow-y-auto space-y-4">
                  <div className="bg-indigo-50/70 border border-indigo-100 p-3.5 rounded-2xl text-xs text-indigo-900">
                    💡 Los destinatarios que respondan <strong>"SALIR"</strong> son añadidos automáticamente aquí y omitidos en futuros envíos aunque estén en tus archivos Excel.
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualBlacklistInput}
                      onChange={e => setManualBlacklistInput(e.target.value)}
                      placeholder="Ej: +593987654321"
                      className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-rose-500 focus:outline-none"
                    />
                    <button
                      onClick={handleAddToBlacklist}
                      className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
                    >
                      Añadir a Lista
                    </button>
                  </div>

                  <div className="border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                      {blacklist.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                          <UserX className="w-8 h-8 opacity-30" />
                          <span>No hay números en la lista negra.</span>
                        </div>
                      ) : (
                        blacklist.map((entry) => (
                          <div key={entry.phone} className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-xs text-slate-800">+{entry.phone}</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                  entry.reason === 'opt_out' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                                }`}>
                                  {entry.reason === 'opt_out' ? `Respondió "${entry.triggerKeyword || 'SALIR'}"` : 'Manual'}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-400">
                                {new Date(entry.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <button
                              onClick={() => handleRemoveFromBlacklist(entry.phone)}
                              title="Remover de lista negra"
                              className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {blacklist.length > 0 && (
                  <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
                    <button
                      onClick={handleClearBlacklist}
                      className="text-xs font-bold text-rose-600 hover:text-rose-800"
                    >
                      Vaciar Lista Negra
                    </button>
                    <button
                      onClick={() => setShowBlacklistModal(false)}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold"
                    >
                      Cerrar
                    </button>
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header con información de sesión y directivo */}
        <header className="px-8 py-5 border-b border-slate-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-md shadow-indigo-200">
              <Send className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                FCSender
                <span className="text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md">
                  Evolution
                </span>
                <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md">
                  v2.1.1
                </span>
              </h1>
              {waStatus.user && (
                <p className="text-[11px] text-slate-500 flex items-center gap-1 font-medium">
                  <PhoneCall className="w-3 h-3 text-emerald-500" />
                  +{waStatus.user.phone} ({waStatus.user.name || 'Directivo'})
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setShowBlacklistModal(true)}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
            >
              <Ban className="w-3.5 h-3.5 text-rose-500" />
              Lista Negra ({blacklist.length})
            </button>

            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200/60">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              En Línea
            </div>
            <button
              onClick={handleLogout}
              title="Cerrar sesión de WhatsApp"
              className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Formulario Principal */}
        <div className="flex-1 overflow-y-auto p-8 space-y-6">

          {/* Sección 1: Base de Contactos & Validación */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">1. Base de Destinatarios</h2>
                {numbers.length > 0 && (
                  <button
                    onClick={() => setShowContacts(!showContacts)}
                    className="text-[11px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2.5 py-0.5 rounded-full transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    {numbers.length} {numbers.length === 1 ? 'contacto' : 'contactos'}
                    <span className="text-[9px]">{showContacts ? '▲' : '▼'}</span>
                  </button>
                )}
                {verifiedValid + verifiedInvalid > 0 && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    reputationPercentage >= 90 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    Salud: {reputationPercentage}%
                  </span>
                )}
              </div>

              {numbers.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleValidateNumbers}
                    disabled={isValidating || waStatus.status !== 'READY'}
                    className="flex items-center gap-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white px-3 py-1.5 rounded-lg shadow-sm transition-colors cursor-pointer"
                  >
                    {isValidating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5" /> Validar en WhatsApp
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setNumbers([])}
                    className="text-xs font-bold text-slate-400 hover:text-rose-600 transition-colors"
                  >
                    Limpiar
                  </button>
                </div>
              )}
            </div>

            {/* Aviso de reputación y números inválidos */}
            {invalidNumbers.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 bg-rose-50 border border-rose-200 p-3.5 rounded-2xl flex items-center justify-between shadow-sm"
              >
                <div className="flex items-center gap-2.5 text-rose-800 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>
                    <strong>{invalidNumbers.length}</strong> números no están registrados en WhatsApp.
                  </span>
                </div>
                <button
                  onClick={handleRemoveInvalidNumbers}
                  className="text-xs bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-xl font-bold transition-colors shadow-sm shrink-0"
                >
                  Filtrar Inexistentes
                </button>
              </motion.div>
            )}

            {/* Entrada rápida de números */}
            <div className="mb-4 bg-white border border-slate-200 rounded-2xl p-4 shadow-sm focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Ingreso Rápido de Números
              </label>
              <p className="text-xs text-slate-400 mb-3">
                Pega números separados por comas, saltos de línea o importa un archivo Excel/CSV.
              </p>

              <div className="flex gap-2 items-start">
                <div
                  className="flex-1 flex flex-wrap gap-1.5 items-center bg-slate-50 border border-slate-200 rounded-xl p-2.5 max-h-40 overflow-y-auto cursor-text min-h-[48px]"
                  onClick={() => document.getElementById('contact-input')?.focus()}
                >
                  <AnimatePresence>
                    {showContacts && numbers.map((num) => {
                      const clean = num.replace(/\D/g, '');
                      const status = numberStatuses[clean];
                      const isInv = status === 'invalid' || invalidNumbers.includes(num);
                      const isVal = status === 'valid';

                      return (
                        <motion.span
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{
                            scale: highlightedNumbers.includes(num) ? [1, 1.1, 1] : 1,
                            opacity: 1
                          }}
                          exit={{ scale: 0.8, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          key={num}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs border transition-colors ${
                            isInv
                              ? 'bg-rose-50 border-rose-300 text-rose-700'
                              : isVal
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                              : 'bg-white border-slate-200 text-slate-700'
                          }`}
                        >
                          {isVal && <Check className="w-3 h-3 text-emerald-600" />}
                          {isInv && <X className="w-3 h-3 text-rose-600" />}
                          {num}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveNumber(num);
                            }}
                            className="text-slate-400 hover:text-rose-600 focus:outline-none transition-colors ml-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </motion.span>
                      );
                    })}
                  </AnimatePresence>
                  <input
                    id="contact-input"
                    type="text"
                    value={manualInput}
                    onChange={handleManualInputChange}
                    onKeyDown={handleManualInputKeyDown}
                    placeholder={numbers.length === 0 ? 'Ej: 0991234567, +59398...' : 'Agregar más...'}
                    className="flex-1 min-w-[130px] bg-transparent text-xs focus:outline-none p-1 text-slate-800"
                  />
                </div>
                <button
                  onClick={addManualButton}
                  className="h-[48px] w-[48px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl font-bold flex items-center justify-center transition-colors shadow-xs shrink-0 border border-indigo-100"
                  title="Añadir número"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Dropzone Excel/CSV */}
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition-all ${
                isDragActive ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'
              }`}
            >
              <input {...getInputProps()} />
              <div className="w-9 h-9 bg-white shadow-xs border border-slate-200 rounded-full flex items-center justify-center mx-auto mb-2 text-slate-400">
                <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
              </div>
              {fileName ? (
                <>
                  <p className="font-semibold text-slate-800 text-xs mb-0.5">{fileName}</p>
                  <p className="text-[11px] text-emerald-600 font-medium">Archivo procesado correctamente</p>
                </>
              ) : (
                <p className="font-medium text-slate-500 text-xs">Arrastra tu archivo Excel o CSV con contactos</p>
              )}
            </div>

            {sheetNames.length > 1 && (
              <div className="mt-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2">
                <select
                  value={selectedSheet}
                  onChange={(e) => setSelectedSheet(e.target.value)}
                  className="flex-1 p-2 bg-white border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  <option value="" disabled>Selecciona la hoja de contactos...</option>
                  {sheetNames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    if (workbook && selectedSheet) processSheet(workbook, selectedSheet);
                  }}
                  disabled={!selectedSheet}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  Extraer
                </button>
              </div>
            )}
          </section>

          {/* Sección 2: Creativo Multimedia (Píxel / Vector Fantasma) */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                2. Adjunto Multimedia <span className="text-slate-400 font-normal normal-case">(Imagen o Video)</span>
              </h2>
              {mediaSizeMB !== null && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                  mediaSizeMB > 16 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                }`}>
                  {mediaSizeMB} MB
                </span>
              )}
            </div>

            {!mediaPreview ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 rounded-2xl p-5 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[105px]"
              >
                <div className="flex items-center gap-2 mb-1.5 text-slate-400">
                  <ImageIcon className="w-5 h-5" />
                  <Video className="w-5 h-5" />
                </div>
                <p className="font-medium text-slate-600 text-xs">Cargar imagen o video de comunicado</p>
                <span className="text-[10px] text-slate-400 mt-0.5">Soporta JPG, PNG, MP4, MOV (Mutación de Hash Anti-Ban por contacto)</span>
              </div>
            ) : (
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 group shadow-sm bg-slate-900">
                {mediaType === 'video' ? (
                  <video
                    src={mediaPreview}
                    controls
                    className="w-full h-44 object-contain bg-black"
                  />
                ) : (
                  <img src={mediaPreview} alt="Preview" className="w-full h-36 object-cover" />
                )}
                <div className="absolute top-2.5 right-2.5 opacity-90 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={removeMedia}
                    className="bg-white/90 backdrop-blur-md text-rose-600 px-2.5 py-1 rounded-lg font-bold text-[11px] flex items-center gap-1 hover:bg-rose-50 shadow-md transition-all"
                  >
                    <X className="w-3.5 h-3.5" /> Quitar
                  </button>
                </div>
                <div className="absolute top-2.5 left-2.5 bg-indigo-900/90 backdrop-blur-md text-white text-[10px] px-2.5 py-1 rounded-lg flex items-center gap-1.5 font-bold shadow-md">
                  <Sparkles className="w-3 h-3 text-amber-300" />
                  {mediaType === 'video' ? 'Vector Fantasma Activo (Hash Único)' : 'Píxel Fantasma 2.0 Activo'}
                </div>
              </div>
            )}

            {mediaType === 'video' && mediaSizeMB !== null && mediaSizeMB > 16 && (
              <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Aviso de peso:</strong> Este video supera los 16 MB ({mediaSizeMB} MB). WhatsApp podría demorar la descarga o fallar en conexiones móviles lentas. Se recomienda enviar videos &lt; 16 MB.
                </span>
              </div>
            )}

            <input
              type="file"
              accept="image/*,video/mp4,video/quicktime,video/x-msvideo,.mp4,.mov"
              ref={fileInputRef}
              onChange={handleMediaChange}
              className="hidden"
            />
          </section>

          {/* Sección 3: Control Anti-Ban y Ritmo */}
          <section>
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5">
              3. Protección Anti-Ban & Ritmo
            </h2>
            <div className="flex flex-col gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex flex-wrap gap-4 items-center">
                <label className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                  Pausar cada
                  <input
                    type="number"
                    min="0"
                    value={batchSize || ''}
                    onChange={e => setBatchSize(Number(e.target.value))}
                    className="w-14 p-1.5 border border-slate-200 rounded-lg text-center font-bold text-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    placeholder="25"
                  />
                  envíos
                </label>
                <div className="h-4 w-px bg-slate-200"></div>
                <label className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                  Descansar
                  <input
                    type="number"
                    min="0"
                    value={restMinutes || ''}
                    onChange={e => setRestMinutes(Number(e.target.value))}
                    className="w-14 p-1.5 border border-slate-200 rounded-lg text-center font-bold text-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    placeholder="5"
                  />
                  minutos
                </label>
              </div>

              <div className="h-px w-full bg-slate-100"></div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-700 font-semibold">Intervalo aleatorio:</span>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  Min:
                  <input
                    type="number"
                    min="1"
                    value={minDelay || ''}
                    onChange={e => setMinDelay(Number(e.target.value))}
                    className="w-14 p-1.5 border border-slate-200 rounded-lg text-center font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    placeholder="15"
                  />
                  s
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  Max:
                  <input
                    type="number"
                    min="2"
                    value={maxDelay || ''}
                    onChange={e => setMaxDelay(Number(e.target.value))}
                    className="w-14 p-1.5 border border-slate-200 rounded-lg text-center font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    placeholder="45"
                  />
                  s
                </label>
              </div>

              {mediaType === 'video' && (
                <>
                  <div className="h-px w-full bg-slate-100"></div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-700 font-semibold flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                      Motor Vector Fantasma (Video):
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setVideoMutationMode('fast')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                          videoMutationMode === 'fast'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                        title="Inyección ISOBMFF de átomos libres (<10ms). Hash criptográfico 100% único sin consumo de CPU."
                      >
                        ⚡ Rápido (Recomendado)
                      </button>
                      <button
                        type="button"
                        onClick={() => setVideoMutationMode('deep')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                          videoMutationMode === 'deep'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                        title="Remuxing FFmpeg con micro-variación acústica y metadatos dinámicos."
                      >
                        🔬 Profundo (Acústico)
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Sección 4: Mensaje, Spintax y Opt-Out */}
          <section className="flex-1 flex flex-col pb-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                4. Mensaje & Cláusula de Baja
              </h2>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {SPINTAX_TAGS.map((tag) => (
                <button
                  key={tag.label}
                  onClick={() => insertSpintax(tag.value)}
                  className="text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-lg transition-colors border border-indigo-100 shadow-2xs"
                >
                  + {tag.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mb-2">
              💡 Puedes editar las opciones de las almohadillas o escribir tu propio Spintax: <code className="bg-slate-200/60 px-1 py-0.5 rounded text-slate-600 font-mono">{"{opción 1|opción 2}"}</code> para alternar textos en cada contacto.
            </p>

            <textarea
              ref={textAreaRef}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              className="flex-1 w-full min-h-[100px] p-3.5 text-xs leading-relaxed bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none mb-3"
              placeholder="Escribe tu mensaje aquí. Usa o personaliza cualquier Spintax con {opción 1|opción 2|opción 3} para enviar variantes distintas a cada destinatario..."
            />

            {/* Configuración Opt-Out Footer */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeOptOut}
                    onChange={e => setIncludeOptOut(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded-md focus:ring-indigo-500"
                  />
                  Incluir cláusula de baja automática ("SALIR")
                </label>
              </div>

              {includeOptOut && (
                <input
                  type="text"
                  value={optOutText}
                  onChange={e => setOptOutText(e.target.value)}
                  placeholder='\n\n_Si quieres dejar de recibir promociones, responde "SALIR"_'
                  className="w-full p-2 bg-white border border-slate-200 rounded-lg text-[11px] font-mono text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Columna Derecha: Métricas, Envíos y Auditoría */}
      <div className="w-[45%] bg-slate-50 flex flex-col relative z-0">
        <div className="flex-1 p-8 flex flex-col">

          {/* Barra Superior de Control */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 tracking-tight">Monitor de Despacho</h2>
              <p className="text-xs text-slate-500">Reporte automático al número del directivo</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleStartSend}
                disabled={isSending || numbers.length === 0 || !messageText || waStatus.status !== 'READY'}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-xl font-bold text-xs shadow-sm transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" /> Iniciar Campaña
              </button>
              <button
                onClick={handleStopSend}
                disabled={!isSending}
                className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-xl font-bold text-xs shadow-sm transition-colors cursor-pointer"
              >
                <SquareSquare className="w-3.5 h-3.5" /> Detener
              </button>
            </div>
          </div>

          {/* Cards de Métricas */}
          <div className="grid grid-cols-2 gap-3.5 mb-6">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
              <span className="text-slate-400 text-[11px] font-bold uppercase tracking-wider">Pendientes en Cola</span>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-3xl font-black text-indigo-600">{queued}</span>
                <span className="text-[11px] font-semibold text-slate-500">de {numbers.length}</span>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between relative overflow-hidden">
              <span className="text-slate-400 text-[11px] font-bold uppercase tracking-wider">Estado del Motor</span>
              <div className="mt-1">
                <span className={`text-base font-extrabold ${isSending ? 'text-amber-500' : 'text-slate-700'}`}>
                  {isSending ? (delayCountdown ? `Pausa: ${delayCountdown}s` : 'Escribiendo...') : 'En Espera'}
                </span>
              </div>
              {isSending && queued > 0 && (
                <span className="absolute top-3.5 right-3.5 text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                  ETA: ~{getETA()}
                </span>
              )}
            </div>
          </div>

          {/* Consola de Actividad y Logs */}
          <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <RefreshCw className={`w-3.5 h-3.5 ${isSending ? 'animate-spin text-indigo-600' : 'text-slate-400'}`} />
                Registro de Actividad
              </h3>
              <div className="flex items-center gap-2">
                {deliveryRecords.length > 0 && (
                  <button
                    onClick={exportReportToExcel}
                    title="Exportar a Excel"
                    className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-bold"
                  >
                    <Download className="w-3.5 h-3.5" /> Excel
                  </button>
                )}
                {logs.length > 0 && (
                  <button
                    onClick={() => setLogs([])}
                    className="text-xs text-slate-400 hover:text-slate-700 font-medium transition-colors"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5 space-y-2 font-mono text-xs">
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2">
                  <AlertCircle className="w-7 h-7 opacity-25" />
                  <p className="text-xs">Sin actividad reciente</p>
                </div>
              ) : (
                logs.map((log, i) => (
                  <div
                    key={i}
                    className={`flex gap-2.5 p-2.5 rounded-xl border text-xs leading-relaxed ${
                      log.type === 'success'
                        ? 'bg-emerald-50/70 border-emerald-100 text-emerald-800'
                        : log.type === 'error'
                        ? 'bg-rose-50/70 border-rose-100 text-rose-800'
                        : 'bg-slate-50 border-slate-100 text-slate-700'
                    }`}
                  >
                    <span className="opacity-50 text-[11px] font-sans shrink-0">{log.time}</span>
                    <span className="font-sans font-medium">{log.msg}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Notificación de Finalización */}
      <AnimatePresence>
        {finishReport && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="absolute bottom-6 right-6 bg-slate-900 text-white p-6 rounded-3xl shadow-2xl z-50 min-w-[340px] border border-slate-700 max-w-sm"
          >
            <div className="flex items-center gap-3.5 mb-4">
              <div className="w-11 h-11 bg-emerald-500/20 rounded-2xl flex items-center justify-center shrink-0 border border-emerald-500/30">
                <CheckCircle className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h3 className="font-extrabold text-base leading-tight">Campaña Concluida</h3>
                <p className="text-slate-400 text-xs mt-0.5">Reporte enviado a tu número de WhatsApp</p>
              </div>
            </div>

            <div className="space-y-2 text-xs font-medium bg-slate-800/70 p-3.5 rounded-2xl border border-slate-700/50 mb-4">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">✅ Entregados con éxito:</span>
                <span className="text-emerald-400 font-bold text-sm">{finishReport.successCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">❌ Errores / No registrados:</span>
                <span className="text-rose-400 font-bold text-sm">{finishReport.errorCount}</span>
              </div>
              {finishReport.blacklistedCount !== undefined && finishReport.blacklistedCount > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">🛡️ Omitidos por Lista Negra:</span>
                  <span className="text-amber-400 font-bold text-sm">{finishReport.blacklistedCount}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-slate-700/60">
                <span className="text-slate-400">⏱️ Tiempo total de campaña:</span>
                <span className="text-indigo-300 font-semibold">{finishReport.timeStr}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={exportReportToExcel}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Descargar Excel
              </button>
              <button
                onClick={() => setFinishReport(null)}
                className="py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-colors"
              >
                Cerrar
              </button>
            </div>

            <button
              onClick={() => setFinishReport(null)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors bg-slate-800 hover:bg-slate-700 rounded-full p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;