import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, QrCode, Smartphone, X } from 'lucide-react';
import fcLogo from '../assets/fc-logo.png';
import type { WhatsAppStatus } from '../types';

interface QrAuthModalProps {
  open: boolean;
  waStatus: WhatsAppStatus;
  onClose: () => void;
  isDark: boolean;
}

export function QrAuthModal({ open, waStatus, onClose, isDark }: QrAuthModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const cardClass = isDark
    ? 'bg-[#161B22] border-[#30363D] text-slate-100'
    : 'bg-white border-slate-200 text-slate-900';

  return (
    <AnimatePresence>
      {open && waStatus.status !== 'READY' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-[3px]"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className={`max-w-md w-full rounded-2xl border p-6 shadow-2xl space-y-5 relative ${cardClass}`}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar ventana de vinculación QR"
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <img src={fcLogo} alt="FCSender" className="w-10 h-10 rounded-xl shadow-xs" />
              <div>
                <h2 id="qr-modal-title" className="text-base font-bold">Vincular WhatsApp</h2>
                <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Escanea el código desde tu teléfono para iniciar
                </p>
              </div>
            </div>

            {waStatus.qr ? (
              <div className="flex flex-col items-center space-y-4">
                <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-sm">
                  <img src={waStatus.qr} alt="Código QR de WhatsApp" className="w-56 h-56" />
                </div>

                <ol
                  className={`w-full rounded-xl border p-3.5 text-xs space-y-1.5 ${
                    isDark ? 'bg-[#0F1318] border-[#252B33] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <li className="flex items-center gap-2">
                    <Smartphone className="w-3.5 h-3.5 text-fc-500 shrink-0" />
                    <span>1. Abre <strong>WhatsApp</strong> en tu teléfono</span>
                  </li>
                  <li className="pl-5">2. Ve a <strong>Dispositivos vinculados &rarr; Vincular dispositivo</strong></li>
                  <li className="pl-5">3. Apunta la cámara hacia este código QR</li>
                </ol>

                <div className={`flex items-center gap-1.5 text-xs font-semibold ${isDark ? 'text-fc-400' : 'text-fc-600'}`}>
                  <QrCode className="w-4 h-4" /> Esperando lectura del QR...
                </div>
              </div>
            ) : (
              <div className="py-10 flex flex-col items-center text-center space-y-3">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center ${isDark ? 'bg-fc-500/15 text-fc-400' : 'bg-fc-50 text-fc-600'}`}>
                  <Loader2 className="w-7 h-7 animate-spin" />
                </div>
                <p className="text-sm font-bold">Preparando sesión segura...</p>
                <p className={`text-xs max-w-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  {waStatus.message || 'Conectando con el motor Evolution empaquetado...'}
                </p>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
