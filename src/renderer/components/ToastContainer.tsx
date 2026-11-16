import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { ToastItem } from '../types';

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  isDark: boolean;
}

export function ToastContainer({ toasts, onDismiss, isDark }: ToastContainerProps) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none"
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const iconMap = {
            success: <CheckCircle2 className="w-4 h-4 text-fc-500 shrink-0 mt-0.5" />,
            error: <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />,
            warn: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />,
            info: <Info className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
          };

          return (
            <motion.div
              key={toast.id}
              role="status"
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.18 }}
              className={`pointer-events-auto rounded-xl border p-3.5 shadow-lg flex items-start gap-3 ${
                isDark
                  ? 'bg-[#161B22] border-[#30363D] text-slate-100'
                  : 'bg-white border-slate-200 text-slate-900'
              }`}
            >
              {iconMap[toast.type]}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold leading-snug">{toast.title}</p>
                {toast.message && (
                  <p className={`text-[11px] mt-0.5 leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                    {toast.message}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label="Cerrar notificación"
                className={`p-1 rounded-md transition-colors ${
                  isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                }`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  isDark: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  isDark,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelBtnRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-desc"
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-950/55 backdrop-blur-[2px]"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className={`max-w-sm w-full rounded-2xl border p-5 shadow-2xl space-y-4 ${
              isDark ? 'bg-[#161B22] border-[#30363D] text-slate-100' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="space-y-1.5">
              <h3 id="confirm-dialog-title" className="text-sm font-bold">{title}</h3>
              <p id="confirm-dialog-desc" className={`text-xs leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                {description}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                ref={cancelBtnRef}
                type="button"
                onClick={onCancel}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold text-white transition-colors ${
                  danger
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-fc-600 hover:bg-fc-700'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
