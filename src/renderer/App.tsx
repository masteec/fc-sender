import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { CampaignView } from './components/CampaignView';
import { LogsView } from './components/LogsView';
import { BlacklistView } from './components/BlacklistView';
import { ProtectionView } from './components/ProtectionView';
import { UpdatesView } from './components/UpdatesView';
import { QrAuthModal } from './components/QrAuthModal';
import { ConfirmDialog, ToastContainer } from './components/ToastContainer';
import { detectAndFormatPhone, replacePhoneCountryCode } from '../shared/phoneUtils';
import type {
  ActiveDelayState,
  AppSettingsData,
  BlacklistEntry,
  BulkFinishData,
  BulkUpdateData,
  ContactItem,
  LogEntry,
  NavTab,
  QueueSummary,
  SafetySettings,
  SendTask,
  SpintaxTag,
  ToastItem,
  UpdaterStatus,
  WhatsAppStatus
} from './types';

const DEFAULT_SPINTAX_TAGS: SpintaxTag[] = [
  { label: 'Saludo', value: '{Hola|Buen día|Qué tal|Saludos}' },
  { label: 'Presentación', value: '{Te escribimos de|Somos de|Nos comunicamos desde}' },
  { label: 'CTA', value: '{¡Escríbenos!|Contáctanos hoy|Más información aquí}' }
];

const DEFAULT_SETTINGS: AppSettingsData = {
  safety: {
    maxPerMinute: 3,
    batchSize: 25,
    restMinutes: 5,
    includeOptOutFooter: true,
    optOutFooterText: 'Para no recibir más avisos de este tipo, responde STOP o BAJA.',
    checkRegisteredBeforeSend: true,
    circuitBreakerThreshold: 5
  }
};

function loadInitialContacts(): ContactItem[] {
  try {
    const v3 = localStorage.getItem('ws_contacts_v3');
    if (v3) return JSON.parse(v3) as ContactItem[];
    const v2 = localStorage.getItem('ws_contacts_v2');
    if (v2) {
      const arr = JSON.parse(v2) as { phone: string }[];
      return arr
        .map((c) => {
          const det = detectAndFormatPhone(c.phone);
          return det
            ? {
                phone: det.phone,
                localNumber: det.localNumber,
                countryDial: det.countryDial,
                validation: 'unknown' as const
              }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    }
  } catch {
    // ignore corrupt storage
  }
  return [];
}

type ConfirmActionState =
  | null
  | {
      type: 'clear-contacts' | 'clear-queue' | 'clear-logs' | 'logout-wa';
      title: string;
      description: string;
      confirmLabel: string;
    };

function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('campaign');
  const [isDark, setIsDark] = useState<boolean>(() => localStorage.getItem('ws_theme') === 'dark');

  const [waStatus, setWaStatus] = useState<WhatsAppStatus>({
    status: 'CONNECTING',
    message: 'Iniciando motor Evolution...'
  });
  const [qrModalDismissed, setQrModalDismissed] = useState(false);

  const [settings, setSettings] = useState<AppSettingsData>(DEFAULT_SETTINGS);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [appVersion, setAppVersion] = useState('2.1.2');
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus>({ state: 'idle' });

  const [contacts, setContacts] = useState<ContactItem[]>(loadInitialContacts);
  const [highlightedDuplicates, setHighlightedDuplicates] = useState<string[]>([]);
  const [isVerifyingContacts, setIsVerifyingContacts] = useState(false);
  const [messageText, setMessageText] = useState(() => localStorage.getItem('ws_msg') || '');
  const [spintaxTags, setSpintaxTags] = useState<SpintaxTag[]>(() => {
    try {
      const saved = localStorage.getItem('ws_spintax_tags');
      return saved ? (JSON.parse(saved) as SpintaxTag[]) : DEFAULT_SPINTAX_TAGS;
    } catch {
      return DEFAULT_SPINTAX_TAGS;
    }
  });

  const [mediaPreview, setMediaPreview] = useState(() => localStorage.getItem('ws_imgPrev') || '');
  const [mediaPath, setMediaPath] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [mediaExt, setMediaExt] = useState('jpg');
  const [mediaName, setMediaName] = useState('');

  const [minDelay, setMinDelay] = useState<number>(() => Number(localStorage.getItem('ws_minD_v2')) || 30);
  const [maxDelay, setMaxDelay] = useState<number>(() => Number(localStorage.getItem('ws_maxD_v2')) || 120);

  const [bulkProgress, setBulkProgress] = useState<BulkUpdateData>({
    queued: 0,
    total: 0,
    processed: 0,
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    isSending: false
  });
  const [activeDelay, setActiveDelay] = useState<ActiveDelayState | null>(null);
  const [etaAnchor, setEtaAnchor] = useState<{ seconds: number; updatedAtMs: number } | null>(null);
  const [lastFinishReport, setLastFinishReport] = useState<BulkFinishData | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const [queueSummary, setQueueSummary] = useState<QueueSummary>({
    total: 0,
    pending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    records: []
  });
  const [blacklistEntries, setBlacklistEntries] = useState<BlacklistEntry[]>([]);
  const [optOutKeywords, setOptOutKeywords] = useState<string[]>([]);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmActionState>(null);

  const notify = useCallback(
    (title: string, message?: string, type: ToastItem['type'] = 'info') => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, title, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const appendLog = useCallback((msg: string, type: LogEntry['type']) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [{ id, time, msg, type }, ...prev.slice(0, 199)]);
  }, []);

  const refreshQueueAndBlacklist = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      const [q, bl] = await Promise.all([
        window.electronAPI.getQueueSummary(),
        window.electronAPI.getBlacklist()
      ]);
      setQueueSummary(q);
      setBlacklistEntries(bl.entries);
      setOptOutKeywords(bl.keywords);
    } catch {
      // ignore initial IPC race
    }
  }, []);

  const verifyPhonesAgainstWhatsApp = useCallback(
    async (phones: string[], showSummaryToast = false) => {
      if (!window.electronAPI || phones.length === 0) return;
      setIsVerifyingContacts(true);
      setContacts((prev) =>
        prev.map((c) => (phones.includes(c.phone) ? { ...c, validation: 'checking' } : c))
      );
      try {
        const results = await window.electronAPI.checkWhatsAppBatch(phones);
        let validCount = 0;
        let invalidCount = 0;
        let blacklistedCount = 0;

        setContacts((prev) =>
          prev.map((c) => {
            const check = results[c.phone];
            if (!check) return c;
            if (check.blacklisted) {
              blacklistedCount++;
              return { ...c, validation: 'blacklisted' };
            }
            if (!check.verified) return { ...c, validation: 'unknown' };
            if (check.valid) {
              validCount++;
              return { ...c, validation: 'valid' };
            }
            invalidCount++;
            return { ...c, validation: 'invalid' };
          })
        );

        if (showSummaryToast) {
          notify(
            'Verificación completada',
            `Activos: ${validCount} · Sin WhatsApp: ${invalidCount}${blacklistedCount > 0 ? ` · Excluidos: ${blacklistedCount}` : ''}`,
            invalidCount > 0 ? 'warn' : 'success'
          );
        }
      } catch {
        setContacts((prev) =>
          prev.map((c) => (phones.includes(c.phone) && c.validation === 'checking' ? { ...c, validation: 'unknown' } : c))
        );
        if (showSummaryToast) {
          notify('Error de verificación', 'No se pudo completar la consulta en WhatsApp.', 'error');
        }
      } finally {
        setIsVerifyingContacts(false);
      }
    },
    [notify]
  );

  useEffect(() => {
    localStorage.setItem('ws_theme', isDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => {
    localStorage.setItem('ws_msg', messageText);
    localStorage.setItem('ws_contacts_v3', JSON.stringify(contacts));
    localStorage.setItem('ws_minD_v2', minDelay.toString());
    localStorage.setItem('ws_maxD_v2', maxDelay.toString());
    localStorage.setItem('ws_spintax_tags', JSON.stringify(spintaxTags));
    try {
      if (mediaPreview && mediaType === 'image' && mediaPreview.startsWith('data:')) {
        localStorage.setItem('ws_imgPrev', mediaPreview);
      } else if (!mediaPreview) {
        localStorage.removeItem('ws_imgPrev');
      }
    } catch {
      // ignore quota exceeded for large preview images
    }
  }, [messageText, contacts, minDelay, maxDelay, mediaPreview, mediaType, spintaxTags]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.getWhatsAppStatus();
    api.getSettings();
    api.getAppVersion().then(setAppVersion).catch(() => {});
    api.getUpdaterStatus().then(setUpdaterStatus).catch(() => {});
    Promise.all([api.getQueueSummary(), api.getBlacklist()])
      .then(([q, bl]) => {
        setQueueSummary(q);
        setBlacklistEntries(bl.entries);
        setOptOutKeywords(bl.keywords);
      })
      .catch(() => {});

    const unsubStatus = api.onWhatsAppStatus((data) => {
      setWaStatus(data);
      if (data.status === 'READY') {
        setQrModalDismissed(false);
      }
    });

    const unsubSettings = api.onAppSettingsData((data) => {
      setSettings(data);
      setSettingsRevision((r) => r + 1);
    });

    const unsubUpdater = api.onUpdaterStatus((data) => setUpdaterStatus(data));

    const unsubBlacklist = api.onBlacklistUpdated(() => {
      void refreshQueueAndBlacklist();
    });

    const unsubUpdate = api.onBulkSenderUpdate((data) => {
      setBulkProgress(data);
      if (typeof data.etaSeconds === 'number') {
        setEtaAnchor({ seconds: data.etaSeconds, updatedAtMs: Date.now() });
      }
      if (!data.isSending) {
        setEtaAnchor(null);
      }
    });

    const unsubProgress = api.onBulkSenderProgress((data) => {
      setActiveDelay(null);
      if (data.status === 'success') {
        appendLog(`✓ Entregado a ${data.number}${data.latencyMs ? ` · ${data.latencyMs}ms` : ''}`, 'success');
      } else if (data.status === 'skipped') {
        appendLog(`↷ Omitido ${data.number}: ${data.error || 'Excluido'}`, 'warn');
        setContacts((prev) =>
          prev.map((c) =>
            c.phone.replace(/\D/g, '') === data.number.replace(/\D/g, '')
              ? { ...c, validation: 'invalid' }
              : c
          )
        );
      } else {
        appendLog(`✗ Error en ${data.number}: ${data.error || 'Fallo de entrega'}`, 'error');
        setContacts((prev) =>
          prev.map((c) =>
            c.phone.replace(/\D/g, '') === data.number.replace(/\D/g, '')
              ? { ...c, validation: 'invalid' }
              : c
          )
        );
      }
    });

    const unsubDelay = api.onBulkSenderDelay((data) => {
      const now = Date.now();
      setActiveDelay({ ...data, startedAtMs: now });
      if (typeof data.etaSeconds === 'number') {
        setEtaAnchor({ seconds: data.etaSeconds, updatedAtMs: now });
      }
    });

    const unsubLog = api.onBulkSenderLog((data) => {
      appendLog(data.msg, data.type);
    });

    const unsubFinish = api.onBulkSenderFinish((data) => {
      setActiveDelay(null);
      setEtaAnchor(null);
      setLastFinishReport(data);
      void refreshQueueAndBlacklist();
      notify(
        data.circuitBreakerTripped
          ? 'Campaña pausada por protección'
          : data.stoppedByUser
          ? 'Campaña detenida'
          : 'Campaña finalizada',
        `Exitosos: ${data.successCount} · Fallidos: ${data.errorCount} · Omitidos: ${data.skippedCount}`,
        data.circuitBreakerTripped
          ? 'error'
          : data.stoppedByUser && data.successCount === 0 && data.errorCount === 0
          ? 'info'
          : data.errorCount > 0
          ? 'warn'
          : 'success'
      );
    });

    return () => {
      unsubStatus();
      unsubSettings();
      unsubUpdater();
      unsubBlacklist();
      unsubUpdate();
      unsubProgress();
      unsubDelay();
      unsubLog();
      unsubFinish();
    };
  }, [appendLog, notify, refreshQueueAndBlacklist]);

  const handleAddContacts = useCallback(
    (incoming: ContactItem[]) => {
      const addedPhones: string[] = [];
      const dupPhones: string[] = [];

      setContacts((prev) => {
        const existingMap = new Map<string, ContactItem>();
        for (const c of prev) existingMap.set(c.phone, c);

        for (const item of incoming) {
          if (existingMap.has(item.phone)) {
            dupPhones.push(item.phone);
          } else {
            existingMap.set(item.phone, item);
            addedPhones.push(item.phone);
          }
        }
        return Array.from(existingMap.values());
      });

      if (dupPhones.length > 0) {
        setHighlightedDuplicates(dupPhones);
        setTimeout(() => setHighlightedDuplicates([]), 1500);
        notify('Números duplicados omitidos', `${dupPhones.length} número(s) ya estaban en la lista.`, 'info');
      }

      if (addedPhones.length > 0) {
        void verifyPhonesAgainstWhatsApp(addedPhones);
      }
    },
    [notify, verifyPhonesAgainstWhatsApp]
  );

  const handleChangeContactCountry = useCallback(
    async (oldPhone: string, newDial: string) => {
      const target = contacts.find((c) => c.phone === oldPhone);
      if (!target) return;

      const updated = replacePhoneCountryCode(
        target.phone,
        target.countryDial || '',
        newDial,
        target.localNumber
      );

      if (contacts.some((c) => c.phone === updated.phone && c.phone !== oldPhone)) {
        setHighlightedDuplicates([updated.phone]);
        setTimeout(() => setHighlightedDuplicates([]), 1500);
        notify('Número duplicado', `${updated.phone} ya existe en la audiencia.`, 'warn');
        return;
      }

      setContacts((prev) =>
        prev.map((c) =>
          c.phone === oldPhone
            ? {
                ...c,
                phone: updated.phone,
                countryDial: updated.countryDial,
                localNumber: updated.localNumber,
                validation: 'checking'
              }
            : c
        )
      );

      if (!window.electronAPI) return;
      const check = await window.electronAPI.checkWhatsAppNumber(updated.phone);
      const nextStatus = check.blacklisted
        ? ('blacklisted' as const)
        : !check.verified
        ? ('unknown' as const)
        : check.valid
        ? ('valid' as const)
        : ('invalid' as const);

      setContacts((prev) =>
        prev.map((c) => (c.phone === updated.phone ? { ...c, validation: nextStatus } : c))
      );

      if (nextStatus === 'valid') {
        notify('Número verificado en WhatsApp', `${updated.phone} es un destinatario válido.`, 'success');
      } else if (nextStatus === 'invalid') {
        notify('Sin cuenta WhatsApp', `${updated.phone} no figura registrado en WhatsApp.`, 'error');
      } else if (nextStatus === 'blacklisted') {
        notify('Número en exclusión', `${updated.phone} está en la lista Opt-Out.`, 'warn');
      }
    },
    [contacts, notify]
  );

  const handleVerifyAllContacts = useCallback(() => {
    if (contacts.length === 0) return;
    if (waStatus.status !== 'READY') {
      setQrModalDismissed(false);
      notify('Vincula tu WhatsApp', 'Escanea el código QR para verificar los números.', 'warn');
      return;
    }
    void verifyPhonesAgainstWhatsApp(
      contacts.map((c) => c.phone),
      true
    );
  }, [contacts, waStatus.status, notify, verifyPhonesAgainstWhatsApp]);

  const handleSaveSafety = async (safety: SafetySettings) => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.saveSettings({ safety });
    setSettings(res.settings);
    setSettingsRevision((r) => r + 1);
    notify('Política de protección actualizada', 'Los nuevos límites se aplicarán en el próximo envío.', 'success');
  };

  const handleStartSend = () => {
    if (contacts.length === 0) {
      notify('Audiencia vacía', 'Carga o ingresa al menos un contacto antes de iniciar.', 'warn');
      return;
    }
    if (!messageText.trim()) {
      notify('Mensaje vacío', 'Redacta el contenido del mensaje antes de iniciar.', 'warn');
      return;
    }
    if (waStatus.status !== 'READY') {
      setQrModalDismissed(false);
      notify('Vincula tu WhatsApp', 'Escanea el código QR para comenzar el envío.', 'warn');
      return;
    }

    setLastFinishReport(null);
    const tasks: SendTask[] = contacts.map((c) => ({
      number: c.phone.replace(/\D/g, ''),
      text: messageText
    }));

    window.electronAPI.startBulkSend(tasks, {
      batchSize: settings.safety.batchSize,
      restMinutes: settings.safety.restMinutes,
      minDelay,
      maxDelay,
      sharedImageDataUrl: mediaType === 'image' && mediaPreview.startsWith('data:') ? mediaPreview : undefined,
      sharedMediaPath: mediaPath || undefined,
      sharedMediaType: mediaPreview ? mediaType : undefined,
      sharedMediaExt: mediaPreview ? mediaExt : undefined
    });
  };

  const handleStopSend = () => {
    window.electronAPI.stopBulkSend();
    notify('Deteniendo campaña...', 'Cancelando esperas y solicitudes activas de forma segura.', 'info');
  };

  const ensureConnectedForQueueAction = (): boolean => {
    if (waStatus.status !== 'READY') {
      setQrModalDismissed(false);
      notify('Vincula tu WhatsApp', 'Escanea el código QR antes de reanudar envíos reales.', 'warn');
      return false;
    }
    return true;
  };

  const handleResumeQueue = () => {
    if (!ensureConnectedForQueueAction()) return;
    setLastFinishReport(null);
    window.electronAPI.resumeBulkSend({
      batchSize: settings.safety.batchSize,
      restMinutes: settings.safety.restMinutes,
      minDelay,
      maxDelay
    });
    setActiveTab('campaign');
  };

  const handleRetryFailed = () => {
    if (!ensureConnectedForQueueAction()) return;
    setLastFinishReport(null);
    window.electronAPI.retryFailedSend({
      batchSize: settings.safety.batchSize,
      restMinutes: settings.safety.restMinutes,
      minDelay,
      maxDelay
    });
    setActiveTab('campaign');
  };

  const handleConfirmAction = async () => {
    if (!confirmState) return;
    const actionType = confirmState.type;
    setConfirmState(null);

    if (actionType === 'clear-contacts') {
      setContacts([]);
      localStorage.removeItem('ws_fileName');
      notify('Lista limpiada', 'Se ha vaciado la audiencia actual.', 'info');
    } else if (actionType === 'clear-queue') {
      if (window.electronAPI) {
        const summary = await window.electronAPI.clearQueue();
        setQueueSummary(summary);
      }
      notify('Cola vaciada', 'Se eliminó la cola persistente y su caché multimedia.', 'info');
    } else if (actionType === 'clear-logs') {
      setLogs([]);
      notify('Consola limpia', 'Se limpiaron los mensajes en pantalla.', 'info');
    } else if (actionType === 'logout-wa') {
      if (window.electronAPI) {
        const res = await window.electronAPI.logoutWhatsApp();
        if (!res.ok && res.message) {
          notify('No disponible', res.message, 'warn');
        } else {
          setQrModalDismissed(false);
          notify('Sesión cerrada', 'Escanea un nuevo código QR para vincular otra cuenta.', 'info');
        }
      }
    }
  };

  const handleAddBlacklist = async (phone: string, reason: string) => {
    if (!window.electronAPI) return;
    const added = await window.electronAPI.addToBlacklist(phone, reason);
    if (added) {
      await refreshQueueAndBlacklist();
      notify('Número excluido', `+${added.phone} no recibirá futuras campañas.`, 'success');
    } else {
      notify('Número inválido', 'Ingresa al menos 7 dígitos válidos para excluir.', 'warn');
    }
  };

  const handleRemoveBlacklist = async (phone: string) => {
    if (!window.electronAPI) return;
    await window.electronAPI.removeFromBlacklist(phone);
    await refreshQueueAndBlacklist();
    notify('Exclusión eliminada', `+${phone} fue removido de la lista.`, 'info');
  };

  const handleCheckUpdates = async () => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.checkForUpdates();
    if ('message' in res && res.message) {
      notify('Actualizaciones', res.message, res.state === 'error' ? 'error' : 'info');
    }
  };

  const handleInstallUpdate = async () => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.installUpdate();
    if (res.blocked && res.message) {
      notify('Actualización pospuesta', res.message, 'warn');
    }
  };

  return (
    <div
      className={`h-screen w-screen overflow-hidden flex transition-colors ${
        isDark ? 'bg-[#0D1117] text-slate-100' : 'bg-[#F4F6F8] text-slate-900'
      }`}
    >
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        waStatus={waStatus}
        appVersion={appVersion}
        blacklistCount={blacklistEntries.length}
        queuedPendingCount={queueSummary.pending}
        isSending={bulkProgress.isSending}
        onOpenQrModal={() => setQrModalDismissed(false)}
        onLogoutWhatsApp={() =>
          setConfirmState({
            type: 'logout-wa',
            title: 'Cerrar sesión de WhatsApp',
            description: 'Se desvinculará el teléfono actual y se generará un nuevo código QR para escanear.',
            confirmLabel: 'Cerrar sesión'
          })
        }
        isDark={isDark}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar
          activeTab={activeTab}
          updaterStatus={updaterStatus}
          isDark={isDark}
          isSending={bulkProgress.isSending}
          contactsCount={contacts.length}
          queuedCount={bulkProgress.queued}
          canStartCampaign={contacts.length > 0 && messageText.trim().length > 0}
          onToggleTheme={() => setIsDark((d) => !d)}
          onStartSend={handleStartSend}
          onStopSend={handleStopSend}
          onInstallUpdate={handleInstallUpdate}
        />

        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'campaign' && (
              <CampaignView
                contacts={contacts}
                onSetContacts={setContacts}
                onAddContacts={handleAddContacts}
                onChangeContactCountry={handleChangeContactCountry}
                onVerifyAllContacts={handleVerifyAllContacts}
                isVerifyingContacts={isVerifyingContacts}
                highlightedDuplicates={highlightedDuplicates}
                messageText={messageText}
                onChangeMessageText={setMessageText}
                spintaxTags={spintaxTags}
                onAddSpintaxTag={(tag) => setSpintaxTags((prev) => [...prev, tag])}
                onDeleteSpintaxTag={(idx) =>
                  setSpintaxTags((prev) => prev.filter((_, i) => i !== idx))
                }
                mediaPreview={mediaPreview}
                mediaType={mediaType}
                mediaName={mediaName}
                onSetMedia={({ preview, path, type, ext, name }) => {
                  if (mediaPreview.startsWith('blob:')) URL.revokeObjectURL(mediaPreview);
                  setMediaPreview(preview);
                  setMediaPath(path);
                  setMediaType(type);
                  setMediaExt(ext);
                  setMediaName(name);
                }}
                onClearMedia={() => {
                  if (mediaPreview.startsWith('blob:')) URL.revokeObjectURL(mediaPreview);
                  setMediaPreview('');
                  setMediaPath('');
                  setMediaType('image');
                  setMediaExt('jpg');
                  setMediaName('');
                }}
                minDelay={minDelay}
                maxDelay={maxDelay}
                onChangeMinDelay={setMinDelay}
                onChangeMaxDelay={setMaxDelay}
                settings={settings}
                isSending={bulkProgress.isSending}
                bulkProgress={bulkProgress}
                activeDelay={activeDelay}
                etaAnchor={etaAnchor}
                lastFinishReport={lastFinishReport}
                onDismissFinishReport={() => setLastFinishReport(null)}
                onOpenReportFile={(filePath) => void window.electronAPI?.openReportFile(filePath)}
                onStopSend={handleStopSend}
                onRequestConfirmClearContacts={() =>
                  setConfirmState({
                    type: 'clear-contacts',
                    title: 'Vaciar audiencia cargada',
                    description: `Se eliminarán los ${contacts.length} contacto(s) de la lista actual. Esto no afecta el historial ni la lista de exclusión.`,
                    confirmLabel: 'Sí, limpiar lista'
                  })
                }
                onOpenProtectionTab={() => setActiveTab('protection')}
                onNotify={notify}
                isDark={isDark}
              />
            )}

            {activeTab === 'logs' && (
              <LogsView
                logs={logs}
                queueSummary={queueSummary}
                isSending={bulkProgress.isSending}
                onRequestClearLogs={() =>
                  setConfirmState({
                    type: 'clear-logs',
                    title: 'Limpiar consola en pantalla',
                    description: 'Se limpiarán los registros mostrados en esta consola. Los archivos de auditoría y resúmenes Excel en disco se conservan intactos.',
                    confirmLabel: 'Limpiar consola'
                  })
                }
                onRefreshQueue={refreshQueueAndBlacklist}
                onResumeQueue={handleResumeQueue}
                onRetryFailed={handleRetryFailed}
                onRequestClearQueue={() =>
                  setConfirmState({
                    type: 'clear-queue',
                    title: 'Vaciar cola persistente',
                    description: 'Se eliminarán todos los registros pendientes, enviados y fallidos de la cola guardada.',
                    confirmLabel: 'Vaciar cola'
                  })
                }
                onOpenLogsFolder={() => window.electronAPI?.openLogsFolder()}
                isDark={isDark}
              />
            )}

            {activeTab === 'blacklist' && (
              <BlacklistView
                entries={blacklistEntries}
                keywords={optOutKeywords}
                onAddEntry={handleAddBlacklist}
                onRemoveEntry={handleRemoveBlacklist}
                isDark={isDark}
              />
            )}

            {activeTab === 'protection' && (
              <ProtectionView
                key={`protection-${settingsRevision}`}
                settings={settings}
                onSaveSafety={handleSaveSafety}
                isDark={isDark}
              />
            )}

            {activeTab === 'updates' && (
              <UpdatesView
                appVersion={appVersion}
                updaterStatus={updaterStatus}
                onCheckUpdates={handleCheckUpdates}
                onInstallUpdate={handleInstallUpdate}
                isDark={isDark}
              />
            )}
          </div>
        </main>
      </div>

      <QrAuthModal
        open={!qrModalDismissed && waStatus.status !== 'READY'}
        waStatus={waStatus}
        onClose={() => setQrModalDismissed(true)}
        isDark={isDark}
      />

      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title || ''}
        description={confirmState?.description || ''}
        confirmLabel={confirmState?.confirmLabel || 'Confirmar'}
        danger
        isDark={isDark}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => void handleConfirmAction()}
      />

      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
        isDark={isDark}
      />
    </div>
  );
}

export default App;
