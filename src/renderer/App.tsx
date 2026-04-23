import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { 
  QrCode, Loader2, CheckCircle, FileSpreadsheet, 
  Image as ImageIcon, Send, X, AlertCircle, Play, SquareSquare, Plus
} from 'lucide-react';

export interface WhatsAppStatus {
  status: 'DISCONNECTED' | 'CONNECTING' | 'READY';
  qr?: string;
  error?: string;
  message?: string;
}

export interface SendTask {
  number: string;
  text: string;
  imagePath?: string;
}

declare global {
  interface Window {
    electronAPI: {
      onWhatsAppStatus: (callback: (data: WhatsAppStatus) => void) => () => void;
      getWhatsAppStatus: () => void;
      startBulkSend: (tasks: SendTask[], config: { batchSize: number, restMinutes: number, minDelay: number, maxDelay: number }) => void;
      stopBulkSend: () => void;
      onBulkSenderUpdate: (callback: (data: {queued: number, isSending: boolean}) => void) => () => void;
      onBulkSenderProgress: (callback: (data: {status: string, number: string, error?: string}) => void) => () => void;
      onBulkSenderDelay: (callback: (data: {delay: number}) => void) => () => void;
      onBulkSenderLog: (callback: (data: {msg: string, type: 'info'|'success'|'error'}) => void) => () => void;
      onBulkSenderFinish: (callback: (data: {successCount: number, errorCount: number, timeStr: string}) => void) => () => void;
    };
  }
}

const SPINTAX_TAGS = [
  { label: 'Saludo', value: '{Hola|Buen día|Qué tal|Saludos}' },
  { label: 'Presentación', value: '{Te escribimos de|Somos de|Nos comunicamos desde}' },
  { label: 'CTA', value: '{¡Escríbenos!|Contáctanos hoy|Más información aquí}' },
];

const ACCEPTED_FILE_TYPES = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv']
};

function App() {
  const [waStatus, setWaStatus] = useState<WhatsAppStatus>({ status: 'CONNECTING', message: 'Iniciando cliente...' });

  const [messageText, setMessageText] = useState(() => localStorage.getItem('ws_msg') || '');
  const [numbers, setNumbers] = useState<string[]>(() => JSON.parse(localStorage.getItem('ws_nums') || '[]'));
  const [manualInput, setManualInput] = useState('');
  const [fileName, setFileName] = useState('');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  
  const [imagePath, setImagePath] = useState(() => localStorage.getItem('ws_imgPath') || '');
  const [imagePreview, setImagePreview] = useState(() => localStorage.getItem('ws_imgPrev') || '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Bulk Sender State
  const [isSending, setIsSending] = useState(false);
  const [queued, setQueued] = useState(0);
  const [logs, setLogs] = useState<{time: string, msg: string, type: 'info'|'success'|'error'}[]>([]);
  const [delayCountdown, setDelayCountdown] = useState<number | null>(null);
  const [showContacts, setShowContacts] = useState(true);
  const [highlightedNumbers, setHighlightedNumbers] = useState<string[]>([]);
  const [invalidNumbers, setInvalidNumbers] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState<number>(() => Number(localStorage.getItem('ws_batch')) || 0);
  const [restMinutes, setRestMinutes] = useState<number>(() => Number(localStorage.getItem('ws_rest')) || 0);
  const [minDelay, setMinDelay] = useState<number>(() => Number(localStorage.getItem('ws_minD')) || 30);
  const [maxDelay, setMaxDelay] = useState<number>(() => Number(localStorage.getItem('ws_maxD')) || 120);
  const [finishReport, setFinishReport] = useState<{successCount: number, errorCount: number, timeStr: string} | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Auto-guardado en caché local cuando cambian los datos
  useEffect(() => {
    localStorage.setItem('ws_msg', messageText);
    localStorage.setItem('ws_nums', JSON.stringify(numbers));
    localStorage.setItem('ws_batch', batchSize.toString());
    localStorage.setItem('ws_rest', restMinutes.toString());
    localStorage.setItem('ws_minD', minDelay.toString());
    localStorage.setItem('ws_maxD', maxDelay.toString());
    localStorage.setItem('ws_imgPath', imagePath);
    try {
        if (imagePreview) localStorage.setItem('ws_imgPrev', imagePreview);
        else localStorage.removeItem('ws_imgPrev');
    } catch (e) {
        console.warn('La imagen es demasiado grande para guardarse en el caché local.');
    }
  }, [messageText, numbers, batchSize, restMinutes, minDelay, maxDelay, imagePath, imagePreview]);

  useEffect(() => {
    const cleanupStatus = window.electronAPI?.onWhatsAppStatus((data) => {
        setWaStatus(data);
        setIsInitializing(false);
    });
    const cleanupUpdate = window.electronAPI?.onBulkSenderUpdate(({ queued, isSending }) => {
      setQueued(queued);
      setIsSending(isSending);
    });
    const cleanupProgress = window.electronAPI?.onBulkSenderProgress(({ status, number, error }) => {
      const time = new Date().toLocaleTimeString();
      if (status === 'success') {
        setLogs(prev => [{time, msg: `Enviado a ${number}`, type: 'success' as const}, ...prev].slice(0, 50));
      } else {
        setLogs(prev => [{time, msg: `Error en ${number}: ${error}`, type: 'error' as const}, ...prev].slice(0, 50));
        setInvalidNumbers(prev => {
            if (!prev.includes(number)) return [...prev, number];
            return prev;
        });
      }
    });
    const cleanupLog = window.electronAPI?.onBulkSenderLog(({ msg, type }) => {
      const time = new Date().toLocaleTimeString();
      setLogs(prev => [{time, msg, type}, ...prev].slice(0, 50));
    });
    const cleanupDelay = window.electronAPI?.onBulkSenderDelay(({ delay }) => {
      setDelayCountdown(Math.ceil(delay / 1000));
    });
    const cleanupFinish = window.electronAPI?.onBulkSenderFinish((data) => {
      setFinishReport(data);
    });

    // Sincronizar estado al montar componente (Crucial para el modo DEV)
    window.electronAPI?.getWhatsAppStatus?.();

    // Fallback de seguridad por si el puente IPC demora más de lo esperado
    const fallbackTimer = setTimeout(() => {
        setIsInitializing(false);
    }, 2000);

    return () => {
      clearTimeout(fallbackTimer);
      if (cleanupStatus) cleanupStatus();
      if (cleanupUpdate) cleanupUpdate();
      if (cleanupProgress) cleanupProgress();
      if (cleanupLog) cleanupLog();
      if (cleanupDelay) cleanupDelay();
      if (cleanupFinish) cleanupFinish();
    };
  }, []);

  // FASE 3: Countdown inteligente en la UI para feedback constante
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
  }, []);

  const processAndAddNumbers = useCallback((input: string, source: 'manual' | 'file') => {
    const rawNumbers = input.split(/[\n,\t; ]+/);
    const processed = rawNumbers.map(n => {
        let clean = n.replace(/\D/g, '');
        if (!clean) return null;
        
        // Reglas de auto-completado de códigos con formato visual
        if (clean.startsWith('09')) {
            // Nacional (Ecuador)
            return '+593' + clean.substring(1);
        } else if (clean.startsWith('9') && clean.length === 9) {
            // Nacional (Ecuador) sin el 0 inicial (omitido por Excel)
            return '+593' + clean;
        } else if (clean.startsWith('1')) {
            // Extranjero USA
            return '+' + clean;
        } else if (clean.length === 10) {
            // Extranjero USA de 10 dígitos sin el código de país
            return '+1' + clean;
        }
        return n.includes('+') ? '+' + clean : clean;
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
        setLogs(prev => [{time, msg: msgStr, type: 'success' as const}, ...prev].slice(0, 50));
    }
  }, [fileName]);

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
         const str = String(cell).trim();
         // Expresión regular que detecta si la celda "parece" un número telefónico
         if (/^[0-9\+\-\s]{8,20}$/.test(str) && str.replace(/\D/g, '').length >= 8) {
             extractedNumbers.push(str);
         }
      });
    });
    
    processAndAddNumbers(extractedNumbers.join(','), 'file');
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
            setSelectedSheet(''); // Reseteamos para forzar la elección del usuario
        }
      } catch (error) {
        alert("Error al leer el archivo Excel/CSV.");
      }
    };
    reader.readAsArrayBuffer(file);
  }, [processSheet]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
      onDrop, 
      accept: ACCEPTED_FILE_TYPES,
      multiple: false
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0] as any;
      setImagePath(file.path);
      
      const reader = new FileReader();
      reader.onload = (e) => {
          setImagePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
      setImagePath('');
      setImagePreview('');
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
        alert("Carga o ingresa al menos un número.");
        return;
    }
    if (!messageText) {
        alert("Escribe un mensaje para enviar.");
        return;
    }

    setInvalidNumbers([]); // Limpiamos errores previos al iniciar un nuevo lote
    const tasks: SendTask[] = numbers.map(number => ({
            number: number.replace(/\D/g, ''), // Limpiamos el '+' u otros caracteres para whatsapp-web.js
        text: messageText,
            imagePath: imagePreview || imagePath || undefined
    }));

    window.electronAPI.startBulkSend(tasks, { batchSize, restMinutes, minDelay, maxDelay });
  };

  const handleStopSend = () => {
    window.electronAPI.stopBulkSend();
  };

  // Calculadora dinámica de ETA
  const getETA = () => {
      if (!isSending || queued === 0) return null;
      
      const avgDelay = (minDelay + maxDelay) / 2;
      let totalSeconds = queued * (avgDelay + 10); // 10s es el promedio de escritura simulada
      if (batchSize > 0 && restMinutes > 0) {
          const batchesLeft = Math.floor(queued / batchSize);
          totalSeconds += batchesLeft * restMinutes * 60;
      }
      
      if (totalSeconds < 60) return `${Math.ceil(totalSeconds)}s`;
      const mins = Math.floor(totalSeconds / 60);
      const hrs = Math.floor(mins / 60);
      return hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
  };

  // Pantalla de Carga (Skeleton) para evitar pantallazo en blanco al inicio
  if (isInitializing) {
      return (
          <div className="flex h-screen bg-slate-50 font-sans overflow-hidden">
              <div className="w-[55%] border-r border-slate-200 bg-white flex flex-col z-10 relative">
                  <header className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-white">
                      <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-200 rounded-lg animate-pulse"></div>
                          <div className="w-32 h-6 bg-slate-200 rounded-lg animate-pulse"></div>
                      </div>
                      <div className="w-28 h-8 bg-slate-100 rounded-full animate-pulse"></div>
                  </header>
                  <div className="flex-1 p-8 space-y-8 overflow-hidden">
                      <div className="space-y-3">
                          <div className="w-48 h-4 bg-slate-200 rounded animate-pulse"></div>
                          <div className="w-full h-32 bg-slate-100 rounded-2xl animate-pulse"></div>
                      </div>
                      <div className="space-y-3">
                          <div className="w-48 h-4 bg-slate-200 rounded animate-pulse"></div>
                          <div className="w-full h-32 bg-slate-100 rounded-2xl animate-pulse"></div>
                      </div>
                      <div className="space-y-3">
                          <div className="w-48 h-4 bg-slate-200 rounded animate-pulse"></div>
                          <div className="w-full h-32 bg-slate-100 rounded-2xl animate-pulse"></div>
                      </div>
                  </div>
              </div>
              <div className="w-[45%] bg-slate-50 flex flex-col relative z-0">
                  <div className="flex-1 p-8 flex flex-col">
                      <div className="flex items-center justify-between mb-6">
                          <div className="w-48 h-6 bg-slate-200 rounded animate-pulse"></div>
                          <div className="flex gap-2">
                              <div className="w-24 h-10 bg-slate-200 rounded-xl animate-pulse"></div>
                              <div className="w-28 h-10 bg-slate-200 rounded-xl animate-pulse"></div>
                          </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 mb-6">
                          <div className="h-24 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm animate-pulse"></div>
                          <div className="h-24 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm animate-pulse"></div>
                      </div>
                      <div className="flex-1 bg-white border border-slate-100 rounded-2xl shadow-sm animate-pulse"></div>
                  </div>
              </div>
          </div>
      );
  }

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      
      {/* Columna Izquierda: Configuración */}
      <div className="w-[55%] border-r border-slate-200 bg-white flex flex-col shadow-sm z-10 relative">
          
        {/* Capa de QR si no hay conexión */}
        <AnimatePresence>
          {waStatus.status !== 'READY' && (
            <motion.div 
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-white/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-8 text-center"
            >
                {waStatus.status === 'DISCONNECTED' && waStatus.qr ? (
                    <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 flex flex-col items-center">
                        <div className="bg-slate-50 p-4 rounded-2xl mb-6">
                            <img src={waStatus.qr} alt="WhatsApp QR" className="w-64 h-64" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800 mb-2">Vincular WhatsApp</h2>
                        <p className="text-slate-500 max-w-sm mb-6">
                            Abre WhatsApp, ve a <strong>Dispositivos vinculados</strong> y escanea el código para iniciar la sesión.
                        </p>
                        <div className="flex items-center gap-2 text-indigo-600 bg-indigo-50 px-4 py-2 rounded-full font-medium text-sm">
                            <QrCode className="w-4 h-4" /> Esperando escaneo...
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center">
                        <div className="w-20 h-20 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mb-6">
                            <Loader2 className="w-8 h-8 animate-spin" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800 mb-2">Conectando...</h2>
                        <p className="text-slate-500 max-w-sm">{waStatus.message || 'Sincronizando con WhatsApp.'}</p>
                    </div>
                )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header simple */}
        <header className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-white">
            <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2 tracking-tight">
                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                    <Send className="w-4 h-4 text-white" />
                </div>
                FCSender
            </h1>
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Sesión Activa
            </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 space-y-6">
            
            {/* Sección: Cargar Excel y Entrada Manual */}
            <section>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">1. Base de Datos</h2>
                    {numbers.length > 0 && (
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setShowContacts(!showContacts)}
                                className="flex items-center gap-1 text-xs font-bold bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-3 py-1 rounded-full transition-colors cursor-pointer"
                            >
                                {numbers.length} contactos
                                <motion.span animate={{ rotate: showContacts ? 180 : 0 }} className="inline-block text-[10px] ml-0.5">▼</motion.span>
                            </button>
                            <button onClick={() => setNumbers([])} className="text-xs font-bold text-red-500 hover:text-red-700 underline underline-offset-2">
                                Limpiar
                            </button>
                        </div>
                    )}
                </div>
                
                {invalidNumbers.length > 0 && (
                    <motion.div 
                        initial={{ opacity: 0, y: -10 }} 
                        animate={{ opacity: 1, y: 0 }} 
                        className="mb-4 bg-rose-50 border border-rose-200 p-3 rounded-xl flex items-center justify-between"
                    >
                        <div className="flex items-center gap-2 text-rose-700 text-sm font-medium">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{invalidNumbers.length} números fallaron o son inválidos.</span>
                        </div>
                        <button
                            onClick={() => {
                                setNumbers(prev => prev.filter(n => !invalidNumbers.includes(n)));
                                setInvalidNumbers([]);
                            }}
                            className="text-xs bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg font-bold transition-colors shrink-0"
                        >
                            Borrar Inválidos
                        </button>
                    </motion.div>
                )}

                {/* Ingreso manual (Más resaltado) */}
                <div className="mb-4 bg-white border-2 border-indigo-400 rounded-2xl p-5 shadow-sm focus-within:border-indigo-600 focus-within:shadow-md transition-all">
                    <label className="block text-xs font-bold text-indigo-800 uppercase tracking-wider mb-2">Ingreso Rápido</label>
                    <p className="text-xs text-slate-500 mb-3">Pega una columna de Excel o escribe los números separados por comas.</p>
                    <div className="flex gap-2 items-start">
                        <div 
                            className="flex-1 flex flex-wrap gap-2 items-center bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-48 overflow-y-auto cursor-text min-h-[50px]"
                            onClick={() => document.getElementById('contact-input')?.focus()}
                        >
                            <AnimatePresence>
                                {showContacts && numbers.map((num) => (
                                    <motion.span
                                        initial={{ scale: 0.8, opacity: 0 }}
                                        animate={{ 
                                            scale: highlightedNumbers.includes(num) ? [1, 1.1, 1] : 1, 
                                            opacity: 1 
                                        }}
                                        exit={{ scale: 0.8, opacity: 0 }}
                                        transition={{ duration: highlightedNumbers.includes(num) ? 0.3 : 0.15 }}
                                        key={num}
                                        className={`flex items-center gap-1.5 border px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm transition-colors ${
                                            highlightedNumbers.includes(num) 
                                                ? 'bg-red-100 border-red-400 text-red-800' 
                                                : invalidNumbers.includes(num)
                                                    ? 'bg-rose-50 border-rose-300 text-rose-700'
                                                    : 'bg-white border-slate-200 text-slate-700'
                                        }`}
                                    >
                                        {num}
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleRemoveNumber(num); }} 
                                            className="text-slate-400 hover:text-red-500 focus:outline-none transition-colors"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </motion.span>
                                ))}
                            </AnimatePresence>
                            <input
                                id="contact-input"
                                type="text"
                                value={manualInput}
                                onChange={handleManualInputChange}
                                onKeyDown={handleManualInputKeyDown}
                                placeholder={numbers.length === 0 ? "Ejemplo: 0987654321, 1305..." : "Agregar más..."}
                                className="flex-1 min-w-[140px] bg-transparent text-sm focus:outline-none p-1"
                            />
                        </div>
                        <button 
                            onClick={addManualButton}
                            className="h-[50px] w-[50px] bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-xl font-bold flex items-center justify-center transition-colors shadow-sm shrink-0"
                            title="Añadir números"
                        >
                            <Plus className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div 
                    {...getRootProps()} 
                    className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                        isDragActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                >
                    <input {...getInputProps()} />
                    <div className="w-10 h-10 bg-white shadow-sm border border-slate-100 rounded-full flex items-center justify-center mx-auto mb-2 text-slate-400">
                        <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    {fileName ? (
                        <>
                            <p className="font-semibold text-slate-700 mb-1 text-sm">{fileName}</p>
                            <p className="text-xs text-emerald-600 font-medium">Archivo cargado y procesado</p>
                        </>
                    ) : (
                        <p className="font-medium text-slate-600 text-sm">O arrastra tu archivo Excel/CSV aquí</p>
                    )}
                </div>

                {sheetNames.length > 1 && (
                    <motion.div 
                        initial={{ opacity: 0, y: -10 }} 
                        animate={{ opacity: 1, y: 0 }} 
                        className="mt-3 p-4 bg-white border border-slate-200 shadow-sm rounded-xl flex flex-col gap-2"
                    >
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Múltiples hojas detectadas en el archivo</label>
                        <div className="flex gap-2">
                            <select 
                                value={selectedSheet} 
                                onChange={(e) => setSelectedSheet(e.target.value)}
                                className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            >
                                <option value="" disabled>Selecciona la hoja a extraer...</option>
                                {sheetNames.map(name => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                            <button
                                onClick={() => { if (workbook && selectedSheet) processSheet(workbook, selectedSheet); }}
                                disabled={!selectedSheet}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-bold rounded-lg transition-colors"
                            >
                                Extraer
                            </button>
                        </div>
                    </motion.div>
                )}
            </section>

            {/* Sección: Imagen (Opcional) */}
            <section>
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">2. Imagen de Propiedad <span className="text-slate-400 font-normal normal-case">(Opcional)</span></h2>
                
                {!imagePreview ? (
                    <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[120px]"
                    >
                        <ImageIcon className="w-6 h-6 text-slate-400 mb-2" />
                        <p className="font-medium text-slate-700 text-sm">Añadir imagen</p>
                    </div>
                ) : (
                    <div className="relative rounded-2xl overflow-hidden border border-slate-200 group">
                        <img src={imagePreview} alt="Preview" className="w-full h-40 object-cover" />
                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button 
                                onClick={removeImage}
                                className="bg-white/90 backdrop-blur text-red-600 px-4 py-2 rounded-xl font-medium text-sm flex items-center gap-2 hover:bg-white"
                            >
                                <X className="w-4 h-4" /> Eliminar
                            </button>
                        </div>
                        <div className="absolute top-3 left-3 bg-indigo-600/90 backdrop-blur text-white text-xs px-2 py-1 rounded-md flex items-center gap-1 font-medium">
                            <CheckCircle className="w-3 h-3" /> Píxel Fantasma Activo
                        </div>
                    </div>
                )}
                <input 
                    type="file" 
                    accept="image/*" 
                    ref={fileInputRef} 
                    onChange={handleImageChange} 
                    className="hidden" 
                />
            </section>

            {/* Sección: Modo Seguro */}
            <section>
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">3. Control de Tiempos (Anti-Ban)</h2>
                <div className="flex flex-col gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm mb-4">
                    <div className="flex gap-4 items-center">
                        <label className="flex items-center gap-2 text-sm text-slate-700 font-medium">
                            Pausar tras enviar
                            <input type="number" min="0" value={batchSize || ''} onChange={e => setBatchSize(Number(e.target.value))} className="w-16 p-1.5 border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none" placeholder="0" />
                            mensajes
                        </label>
                        <div className="h-6 w-px bg-slate-200"></div>
                        <label className="flex items-center gap-2 text-sm text-slate-700 font-medium">
                            Descansar
                            <input type="number" min="0" value={restMinutes || ''} onChange={e => setRestMinutes(Number(e.target.value))} className="w-16 p-1.5 border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none" placeholder="0" />
                            minutos
                        </label>
                    </div>
                    <div className="h-px w-full bg-slate-100"></div>
                    <div className="flex gap-4 items-center">
                        <span className="text-sm text-slate-700 font-medium">Espera entre mensajes:</span>
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                            Min:
                            <input type="number" min="1" value={minDelay || ''} onChange={e => setMinDelay(Number(e.target.value))} className="w-16 p-1.5 border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none" placeholder="30" />
                            s
                        </label>
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                            Max:
                            <input type="number" min="2" value={maxDelay || ''} onChange={e => setMaxDelay(Number(e.target.value))} className="w-16 p-1.5 border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none" placeholder="120" />
                            s
                        </label>
                    </div>
                </div>
            </section>

            {/* Sección: Mensaje */}
            <section className="flex-1 flex flex-col pb-4">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">4. Mensaje (Spintax)</h2>
                </div>
                
                <div className="flex flex-wrap gap-2 mb-3">
                    {SPINTAX_TAGS.map((tag) => (
                        <button
                            key={tag.label}
                            onClick={() => insertSpintax(tag.value)}
                            className="text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg transition-colors border border-indigo-100"
                        >
                            + {tag.label}
                        </button>
                    ))}
                </div>

                <textarea 
                    ref={textAreaRef}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                        className="flex-1 w-full min-h-[120px] p-4 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none mt-2"
                        placeholder="Hola {Hola|Buen día}, te escribo para..."
                    />
                </section>
            </div>
        </div>

        {/* Columna Derecha: Estado y Logs */}
        <div className="w-[45%] bg-slate-50 flex flex-col relative z-0">
            <div className="flex-1 p-8 flex flex-col">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-bold text-slate-800">Estado del Envío</h2>
                    <div className="flex gap-2">
                        <button 
                            onClick={handleStartSend}
                            disabled={isSending || numbers.length === 0 || !messageText}
                            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-xl font-bold transition-colors"
                        >
                            <Play className="w-4 h-4" /> Iniciar
                        </button>
                        <button 
                            onClick={handleStopSend}
                            disabled={!isSending}
                            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-xl font-bold transition-colors"
                        >
                            <SquareSquare className="w-4 h-4" /> Detener
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                        <span className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">En Cola</span>
                        <span className="text-3xl font-extrabold text-indigo-600">{queued}</span>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col relative">
                        <span className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Estado</span>
                        <span className={`text-lg font-bold ${isSending ? 'text-amber-500' : 'text-slate-600'} transition-all`}>
                            {isSending ? (delayCountdown ? `Esperando ${delayCountdown}s...` : 'Enviando...') : 'En Espera'}
                        </span>
                        {isSending && queued > 0 && (
                            <span className="absolute top-4 right-4 text-xs font-extrabold text-indigo-500 bg-indigo-50 px-2 py-1 rounded-md animate-pulse">
                                ETA: ~{getETA()}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Registro de Actividad</h3>
                        {logs.length > 0 && (
                            <button onClick={() => setLogs([])} className="text-xs text-slate-500 hover:text-slate-700 font-medium">Limpiar</button>
                        )}
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {logs.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3">
                                <AlertCircle className="w-8 h-8 opacity-20" />
                                <p className="text-sm">No hay actividad reciente</p>
                            </div>
                        ) : (
                            logs.map((log, i) => (
                                <div key={i} className={`flex gap-3 text-sm p-3 rounded-xl border ${
                                    log.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 
                                    log.type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-700' : 
                                    'bg-slate-50 border-slate-100 text-slate-700'
                                }`}>
                                    <span className="opacity-50 text-xs font-medium w-16 shrink-0">{log.time}</span>
                                    <span className="font-medium">{log.msg}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
        
        {/* Notificación Flotante de Finalización */}
        <AnimatePresence>
            {finishReport && (
                <motion.div
                    initial={{ opacity: 0, y: 50, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.9 }}
                    className="absolute bottom-8 right-8 bg-slate-900 text-white p-6 rounded-2xl shadow-2xl z-50 min-w-[320px] border border-slate-700"
                >
                    <div className="flex items-center gap-4 mb-5">
                        <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center shrink-0">
                            <CheckCircle className="w-7 h-7 text-emerald-400" />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg leading-tight">Envío Finalizado</h3>
                            <p className="text-slate-400 text-xs mt-0.5">Se ha enviado un reporte a tu WhatsApp</p>
                        </div>
                    </div>
                    <div className="space-y-2.5 text-sm font-medium bg-slate-800/50 p-4 rounded-xl">
                        <div className="flex justify-between items-center"><span className="text-slate-400">✅ Enviados:</span><span className="text-emerald-400 font-bold text-base">{finishReport.successCount}</span></div>
                        <div className="flex justify-between items-center"><span className="text-slate-400">❌ Fallidos:</span><span className="text-rose-400 font-bold text-base">{finishReport.errorCount}</span></div>
                        <div className="flex justify-between items-center pt-2 border-t border-slate-700/50"><span className="text-slate-400">⏱️ Tiempo total:</span><span className="text-indigo-300">{finishReport.timeStr}</span></div>
                    </div>
                    <button onClick={() => setFinishReport(null)} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors bg-slate-800 hover:bg-slate-700 rounded-full p-1">
                        <X className="w-4 h-4" />
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
      </div>
    );
  }
  
  export default App;