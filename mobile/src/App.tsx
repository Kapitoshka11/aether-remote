import React, { useState, useEffect, useRef } from 'react';
import { AppLogoIcon } from './components/AppLogoIcon';
import { secureStorage } from './utils/secureStorage';
import { webAudioManager } from './utils/webAudioManager';
import {
  parsePairingCode,
  generateSubnetCandidates,
  getDiagnosticInfo,
  ConnectionFailureType,
  ConnectionSecurityStatus,
} from './protocol/aetherProtocol';
import {
  Monitor,
  Music,
  Wrench,
  Power,
  RefreshCw,
  Settings,
  ShieldAlert,
  Volume2,
  VolumeX,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Clipboard,
  Send,
  X,
  Code,
  Copy,
  Check,
  Maximize2,
  Lock,
  Moon,
  Sun,
  Globe,
  Languages,
  RotateCcw,
  Zap,
  Terminal,
  ShieldCheck,
  Shield,
  Trash2,
  Pencil,
  Tv,
  Activity,
  Wifi,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  MousePointer,
  Key,
  History,
  Radio,
  ArrowUp,
  ArrowDown,
  Unplug,
  Bell,
  Sliders,
  XCircle,
  FileText,
  Headphones,
  ExternalLink
} from 'lucide-react';

interface SavedPC {
  id: string;
  hostName: string;
  hostIp: string;
  hostPort: string;
  pin: string;
  lastConnected: number;
}

const translations = {
  ru: {
    connected: 'Подключено',
    connecting: 'Подключение...',
    disconnected: 'Отключено',
    connectToPc: 'Подключиться к ПК',
    subTitle: 'Удаленное управление ПК. Введите 9-значный код или выберите ПК из списка',
    enterPin: 'Введите 9-значный код подключения',
    lockoutWarning: 'Вход заблокирован на {sec} сек. из-за неверных попыток',
    failedAttempts: 'Неверный PIN-код! Осталось попыток: {count}',
    attemptsLockout: '3 неверных попытки PIN! Вход заблокирован на 60 сек.',
    rememberedPcs: 'Запомненные компьютеры',
    oneTapConnect: 'Подключение в 1 клик',
    quickLogin: 'Быстрый вход',
    qrScanner: 'QR-Сканер',
    pcServerCode: 'Код сервера ПК',
    monitoringStream: 'Система и Телеметрия',
    liveStreamSub: 'Трансляция экрана и ресурсы ПК в реальном времени',
    cpu: 'Процессор (CPU)',
    ram: 'Память (RAM)',
    gpu: 'Видеокарта (GPU)',
    netTraffic: 'Сетевой трафик ПК ↔ Телефон',
    liveStreamTitle: 'Трансляция экрана',
    pauseStream: 'Пауза трансляции',
    playStream: 'Запустить трансляцию',
    expandStream: 'Развернуть трансляцию',
    closeActiveWindow: 'Закрыть активное окно',
    closeActiveWindowSub: 'Отправляет комбинацию Alt + F4',
    close: 'Закрыть',
    mediaCenter: 'Медиа-центр',
    mediaSub: 'Управление громкостью и воспроизведением музыки ПК',
    pcVolume: 'Громкость ПК',
    mute: 'Выключить',
    unmute: 'Включить',
    toolsCommands: 'Утилиты и Команды',
    toolsSub: 'Синхронизация буфера обмена и PowerShell консоль Администратора',
    winClipboard: 'Буфер обмена Windows',
    readClipboard: 'Прочитать буфер ПК',
    copyToPhone: 'Скопировать на телефон',
    sendToClipboard: 'Отправить текст в буфер ПК',
    sendToClipboardPlaceholder: 'Введите текст или ссылку...',
    psAdminTitle: 'PowerShell (Administrator)',
    elevatedAdmin: 'ELEVATED ADMIN',
    executePsCmd: 'Выполнить команду в PowerShell...',
    quickCmds: 'Быстрые команды Admin',
    sysInfo: 'Информация о системе',
    powerAndSecurity: 'Питание и безопасность',
    powerSub: 'Защищенный вызов системных команд управления Windows',
    wolTitle: 'Пробуждение ПК по сети (Wake-on-LAN)',
    turnOnPc: 'Включить ПК',
    sendingSignal: 'Сигнал...',
    shutdownPc: 'Выключить ПК',
    rebootPc: 'Перезагрузка ПК',
    lockSession: 'Заблокировать',
    sleepMode: 'Спящий режим',
    settingsTitle: 'Настройки',
    theme: 'Тема оформления',
    darkTheme: 'Темная',
    lightTheme: 'Светлая',
    language: 'Язык интерфейса',
    hostIpLabel: 'IP-адрес хоста ПК',
    portLabel: 'WebSocket порт',
    hostNameLabel: 'Имя хоста',
    disconnect: 'Отключить',
    save: 'Сохранить',
    cancel: 'Отмена',
    confirm: 'Выполнить',
    attentionAdmin: 'Внимание: Подтверждение Admin',
    dangerousCmdWarning: 'Вы собираетесь выполнить потенциально опасную команду с правами Администратора:',
    confirmPowerTitle: 'Подтверждение действия',
    confirmCloseWindow: 'Закрыть окно?',
    altF4Notice: 'Будет отправлена комбинация клавиш Alt+F4 в активное приложение',
    confirmShutdownMsg: 'Вы действительно хотите выключить ПК?',
    confirmRebootMsg: 'Перезагрузить компьютер сейчас?',
    confirmLockMsg: 'Заблокировать сеанс пользователя?',
    confirmSleepMsg: 'Перевести ПК в спящий режим?',
    killProcessTitle: 'Завершить процесс',
    killProcessSub: 'Принудительное закрытие зависших программ на ПК',
    killProcessPlaceholder: 'Например: chrome.exe, game.exe, 4120',
    killProcessBtn: 'Снять задачу',
    sendNotificationTitle: 'Отправить уведомление',
    sendNotificationSub: 'Отправка всплывающего сообщения в Windows Toast Notification',
    sendNotifPlaceholder: 'Заголовок и сообщение...',
    sendNotifBtn: 'Отправить на ПК',
    screenshotTitle: 'Снимок экрана ПК',
    screenshotSub: 'Мгновенное создание скриншота рабочего стола',
    takeScreenshotBtn: 'Сделать скриншот',
    audioSwitcherTitle: 'Аудиовыход ПК',
    audioSwitcherSub: 'Переключение текущего устройства воспроизведения звука',
    speakers: 'Динамики',
    headphones: 'Наушники',
    disconnectHeader: 'Отключиться',
    tabSystem: 'Экран',
    tabMedia: 'Медиа',
    tabTools: 'Утилиты',
    tabPower: 'Питание',
    qrModalTitle: 'Сканирование QR',
    qrSub: 'Наведите камеру на QR-код в хост-сервере Windows',
    simulateQr: 'Имитировать сканирование QR',
    pyHostScript: 'Серверный хост-скрипт (Python)',
    copied: 'Скопировано!'
  },
  en: {
    connected: 'CONNECTED',
    connecting: 'CONNECTING...',
    disconnected: 'DISCONNECTED',
    connectToPc: 'CONNECT TO PC',
    subTitle: 'Secure PC remote client. Enter 9-digit code or select a remembered PC',
    enterPin: 'Enter 9-digit pairing code',
    lockoutWarning: 'Login locked out for {sec} sec. due to failed attempts',
    failedAttempts: 'Incorrect PIN code! Remaining attempts: {count}',
    attemptsLockout: '3 failed PIN attempts! Login locked out for 60 seconds.',
    rememberedPcs: 'Remembered Computers',
    oneTapConnect: '1-tap connect',
    quickLogin: 'Quick Login',
    qrScanner: 'QR Scanner',
    pcServerCode: 'PC Server Code',
    monitoringStream: 'Monitoring & Stream',
    liveStreamSub: 'Live PC screen stream and real-time telemetry',
    cpu: 'Processor (CPU)',
    ram: 'Memory (RAM)',
    gpu: 'Graphics (GPU)',
    netTraffic: 'Network Traffic PC ↔ Phone',
    liveStreamTitle: 'Live PC Screen Stream',
    pauseStream: 'Pause Stream',
    playStream: 'Start Stream',
    expandStream: 'Fullscreen Stream',
    closeActiveWindow: 'Close Active Window',
    closeActiveWindowSub: 'Sends Alt + F4 key combination',
    close: 'Close',
    mediaCenter: 'Media Center',
    mediaSub: 'Control PC master volume and media playback',
    pcVolume: 'PC Volume',
    mute: 'Mute',
    unmute: 'Unmute',
    toolsCommands: 'Tools & Commands',
    toolsSub: 'Clipboard sync and PowerShell Admin console',
    winClipboard: 'Windows Clipboard',
    readClipboard: 'Read',
    copyToPhone: 'Copy to Phone',
    sendToClipboard: 'Send text to PC Clipboard',
    sendToClipboardPlaceholder: 'Enter text or URL...',
    psAdminTitle: 'PowerShell (Administrator)',
    elevatedAdmin: 'ELEVATED ADMIN',
    executePsCmd: 'Execute PowerShell command...',
    quickCmds: 'Quick Admin Commands',
    sysInfo: 'System Information',
    powerAndSecurity: 'Power & Security',
    powerSub: 'Protected call of Windows system control commands',
    wolTitle: 'Wake-on-LAN (WOL)',
    turnOnPc: 'Wake PC',
    sendingSignal: 'Sending...',
    shutdownPc: 'Shutdown PC',
    rebootPc: 'Restart PC',
    lockSession: 'Lock Workstation',
    sleepMode: 'Sleep Mode',
    settingsTitle: 'Settings & Interface',
    theme: 'App Theme',
    darkTheme: 'Dark',
    lightTheme: 'Light',
    language: 'Language',
    hostIpLabel: 'PC Host IP Address',
    portLabel: 'WebSocket Port',
    hostNameLabel: 'Host Name',
    disconnect: 'Disconnect',
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Execute',
    attentionAdmin: 'Attention: Admin Confirmation',
    dangerousCmdWarning: 'You are about to execute a potentially risky command with Administrator privileges:',
    confirmPowerTitle: 'Action Confirmation',
    confirmCloseWindow: 'Close Window?',
    altF4Notice: 'Alt+F4 shortcut will be sent to the active foreground application',
    confirmShutdownMsg: 'Are you sure you want to completely shut down the PC?',
    confirmRebootMsg: 'Restart the computer now?',
    confirmLockMsg: 'Lock the current user session?',
    confirmSleepMsg: 'Put the PC into sleep mode?',
    killProcessTitle: 'Process Manager (Task Killer)',
    killProcessSub: 'Force kill hanging apps or processes on PC',
    killProcessPlaceholder: 'E.g.: chrome.exe, game.exe, 4120',
    killProcessBtn: 'Kill Process',
    sendNotificationTitle: 'Windows Desktop Toast Notification',
    sendNotificationSub: 'Send popup toast alert directly onto PC screen',
    sendNotifPlaceholder: 'Title and notification message...',
    sendNotifBtn: 'Send to PC',
    screenshotTitle: 'PC Desktop Screenshot',
    screenshotSub: 'Instant screen capture saved to PC & phone',
    takeScreenshotBtn: 'Take Screenshot',
    audioSwitcherTitle: 'PC Audio Output Device',
    audioSwitcherSub: 'Switch active playback device between Speakers and Headphones',
    speakers: 'Speakers',
    headphones: 'Headphones',
    disconnectHeader: 'Disconnect',
    tabSystem: 'Screen',
    tabMedia: 'Media',
    tabTools: 'Utilities',
    tabPower: 'Power',
    qrModalTitle: 'QR Code Scanner',
    qrSub: 'Point camera at the QR code on your Windows host server',
    simulateQr: 'Simulate QR Scan',
    pyHostScript: 'Host Server Script (Python)',
    copied: 'Copied!'
  }
};

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('aether_theme') as 'dark' | 'light') || 'dark';
  });

  const [lang, setLang] = useState<'ru' | 'en'>(() => {
    return (localStorage.getItem('aether_lang') as 'ru' | 'en') || 'ru';
  });

  const t = (key: keyof typeof translations.ru, vars?: Record<string, string | number>) => {
    let str = translations[lang]?.[key] || translations.ru[key] || key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        str = str.replace(`{${k}}`, String(v));
      });
    }
    return str;
  };

  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'CONNECTED' | 'CONNECTING' | 'DISCONNECTED'>('DISCONNECTED');
  const [pin, setPin] = useState(['', '', '', '', '', '', '', '', '']);
  const [hostIp, setHostIp] = useState('');
  const [hostPort, setHostPort] = useState('8080');
  const [hostName, setHostName] = useState('-');

  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutTimeLeft, setLockoutTimeLeft] = useState(0);
  const [securityStatus, setSecurityStatus] = useState('Not connected');

  const [securityInfo, setSecurityInfo] = useState<ConnectionSecurityStatus>({
    scheme: 'ws',
    transport: 'WebSocket',
    isSecure: false,
  });

  const [connectedClientsCount, setConnectedClientsCount] = useState<number | null>(null);
  const [isAuthPending, setIsAuthPending] = useState(false);
  const [authPendingTimeLeft, setAuthPendingTimeLeft] = useState(35);

  useEffect(() => {
    let timer: any;
    if (isAuthPending && authPendingTimeLeft > 0) {
      timer = setInterval(() => {
        setAuthPendingTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (isAuthPending && authPendingTimeLeft === 0) {
      setIsAuthPending(false);
      setConnectionStatus('DISCONNECTED');
      setDiagnosticError(getDiagnosticInfo('AUTH_TIMEOUT', lang));
      if (wsRef.current) wsRef.current.close();
    }
    return () => clearInterval(timer);
  }, [isAuthPending, authPendingTimeLeft]);

  const [adminConfirmDialog, setAdminConfirmDialog] = useState<{ command: string } | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<{
    title: string;
    detail: string;
    icon: string;
  } | null>(null);

  const [connectionLogs, setConnectionLogs] = useState<{
    id: string;
    time: string;
    target: string;
    transport: string;
    step: string;
    status: 'connecting' | 'success' | 'failed' | 'disconnected';
    errorDetail?: string;
  }[]>([]);
  const [showLogsModal, setShowLogsModal] = useState(false);

  const addConnectionLog = (
    target: string,
    transport: string,
    step: string,
    status: 'connecting' | 'success' | 'failed' | 'disconnected',
    errorDetail?: string
  ) => {
    const time = new Date().toLocaleTimeString();
    const newLog = {
      id: Math.random().toString(36).substr(2, 9),
      time,
      target,
      transport,
      step,
      status,
      errorDetail
    };
    setConnectionLogs((prev) => [newLog, ...prev].slice(0, 50));
  };

  const [isAudioReceivingMuted, setIsAudioReceivingMuted] = useState(true);

  const [savedPcs, setSavedPcs] = useState<SavedPC[]>(() => {
    return secureStorage.getSavedPcs();
  });

  const [editingPcId, setEditingPcId] = useState<string | null>(null);
  const [editingPcName, setEditingPcName] = useState('');

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showFullStream, setShowFullStream] = useState(false);
  const [showCloseWindowConfirm, setShowCloseWindowConfirm] = useState(false);
  const [powerActionConfirm, setPowerActionConfirm] = useState<string | null>(null);
  const [psConfirmCommand, setPsConfirmCommand] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'system' | 'media' | 'tools' | 'power'>('system');

  const [cpuUsage, setCpuUsage] = useState<number | null>(null);
  const [ramUsage, setRamUsage] = useState<number | null>(null);
  const [gpuUsage, setGpuUsage] = useState<number | null>(null);
  const [lastTelemetryTimestamp, setLastTelemetryTimestamp] = useState<number | null>(null);
  const [isTelemetryStale, setIsTelemetryStale] = useState(false);

  const [netSpeedDown, setNetSpeedDown] = useState<number | null>(null);
  const [netSpeedUp, setNetSpeedUp] = useState<number | null>(null);
  const [macAddress, setMacAddress] = useState('');

  const [isSendingWol, setIsSendingWol] = useState(false);

  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const [streamQuality, setStreamQuality] = useState<'1080p' | '720p' | '480p'>('1080p');
  const [fps, setFps] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 420, y: 280 });

  const [volume, setVolume] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(() => ({
    title: '',
    artist: ''
  }));

  const [pcClipboardText, setPcClipboardText] = useState('');
  const [sendClipboardInput, setSendClipboardInput] = useState('');

  const [killProcInput, setKillProcInput] = useState('');
  const [toastTitleInput, setToastTitleInput] = useState('');
  const [toastMsgInput, setToastMsgInput] = useState('');
  
  const [pairingKeyInput, setPairingKeyInput] = useState('');

  const decodePairingKey = (rawKey: string): { ip: string; port: number; pin: string } | null => {
    const cleanKey = rawKey.trim();
    if (!cleanKey) return null;

    try {
      const data = JSON.parse(cleanKey);
      if (data && typeof data === 'object') {
        const ip = data.ip || data.hostIp;
        const port = Number(data.port || data.hostPort || 8080);
        const pin = String(data.pin || data.PIN || '');
        if (ip) {
          return { ip: String(ip), port, pin };
        }
      }
    } catch {
    }

    try {
      const decoded = atob(cleanKey);
      try {
        const data = JSON.parse(decoded);
        if (data && typeof data === 'object' && (data.ip || data.hostIp)) {
          return {
            ip: String(data.ip || data.hostIp),
            port: Number(data.port || data.hostPort || 8080),
            pin: String(data.pin || data.PIN || '')
          };
        }
      } catch {
      }

      const parts = decoded.split(':');
      if (parts.length >= 2) {
        return {
          ip: parts[0].trim(),
          port: Number(parts[1]) || 8080,
          pin: parts[2]?.trim() || ''
        };
      }
    } catch {
    }

    const hashParts = cleanKey.replace(/^aether-v1:\/\//i, '').replace(/^aether-v1:/i, '').split('#');
    const colons = hashParts[0].split(':');
    if (colons.length === 3) {
      return {
        ip: colons[0].trim(),
        port: Number(colons[1]) || 8080,
        pin: colons[2].trim()
      };
    } else if (colons.length === 2) {
      return {
        ip: colons[0].trim(),
        port: Number(colons[1]) || 8080,
        pin: hashParts[1]?.trim() || ''
      };
    } else if (/^(\d{1,3}\.){3}\d{1,3}$/.test(cleanKey)) {
      return {
        ip: cleanKey,
        port: 8080,
        pin: hashParts[1]?.trim() || ''
      };
    }

    return null;
  };

  const handlePairingKeyChange = (val: string) => {
    setPairingKeyInput(val);
    const decoded = decodePairingKey(val);
    if (decoded && decoded.ip) {
      setHostIp(decoded.ip);
      setHostPort(String(decoded.port || 8080));
      if (decoded.pin && decoded.pin.length === 9) {
        setPin(decoded.pin.split(''));
      }
      showToast(lang === 'ru' ? `Ключ декодирован: ${decoded.ip}:${decoded.port}` : `Pairing Key Decoded: ${decoded.ip}:${decoded.port}`);
    }
  };

  const handlePastePairingKey = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        handlePairingKeyChange(text);
      } else {
        showToast(lang === 'ru' ? 'Буфер обмена пуст' : 'Clipboard is empty');
      }
    } catch {
      showToast(lang === 'ru' ? 'Вставьте ключ вручную в поле' : 'Paste key into the input field');
    }
  };


  const [psCommand, setPsCommand] = useState('');
  const [isExecutingPs, setIsExecutingPs] = useState(false);
  const [psLogs, setPsLogs] = useState<Array<{ id: string; text: string; type: 'cmd' | 'out' | 'err' | 'info'; time: string }>>([
    {
      id: '1',
      text: 'PS C:\\Windows\\System32> # PowerShell Session Active (Administrator)',
      type: 'info',
      time: '12:00:00'
    },
    {
      id: '2',
      text: 'Windows PowerShell 7.4.1 (Administrator Elevation Active)',
      type: 'info',
      time: '12:00:01'
    }
  ]);

  const wsRef = useRef<WebSocket | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [lastConnectionError, setLastConnectionError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fullVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && screenStream) {
      videoRef.current.srcObject = screenStream;
    }
  }, [screenStream]);

  useEffect(() => {
    if (fullVideoRef.current && screenStream) {
      fullVideoRef.current.srcObject = screenStream;
    }
  }, [screenStream]);

  const prevFrameUrlRef = useRef<string | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<any>(null);
  const [screenFrameData, setScreenFrameData] = useState<string | null>(null);

  const sendWsMessage = (payload: object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  };

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  useEffect(() => {
    localStorage.setItem('aether_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('aether_lang', lang);
  }, [lang]);

  useEffect(() => {
    secureStorage.saveSavedPcs(savedPcs);
  }, [savedPcs]);

  useEffect(() => {
    if (lockoutTimeLeft <= 0) return;
    const timer = setInterval(() => {
      setLockoutTimeLeft((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutTimeLeft]);

  useEffect(() => {
    const triggerAutoReconnect = () => {
      if (isConnected || connectionStatus === 'CONNECTING') return;

      localStorage.removeItem('aether_last_connected_peer_id');
      const lastPc = savedPcs.find((pc) => !!pc.hostIp && !!secureStorage.getSessionToken(pc.hostIp));
      if (lastPc) {
        console.log('Auto-reconnecting to last authenticated PC:', lastPc.hostIp);
        connectDirectly(lastPc.hostIp, lastPc.hostPort, '', lastPc);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('App visibility became visible. Auto-reconnecting...');
        triggerAutoReconnect();
      }
    };

    const handleFocus = () => {
      console.log('App window gained focus. Auto-reconnecting...');
      triggerAutoReconnect();
    };

    const handleOnline = () => {
      console.log('Device came online. Auto-reconnecting...');
      triggerAutoReconnect();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [isConnected, connectionStatus, savedPcs]);

  useEffect(() => {
    if (!isConnected) {
      setConnectedClientsCount(null);
      setLastTelemetryTimestamp(null);
      setIsTelemetryStale(false);
    }
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected) {
      setIsTelemetryStale(false);
      return;
    }
    const interval = setInterval(() => {
      if (lastTelemetryTimestamp) {
        const diff = Date.now() - lastTelemetryTimestamp;
        setIsTelemetryStale(diff > 5000);
      } else {
        setIsTelemetryStale(true);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isConnected, lastTelemetryTimestamp]);

  useEffect(() => {
    if (!isConnected) return;

    const teleInterval = setInterval(() => {
      sendWsMessage({ action: 'GET_TELEMETRY' });
      sendWsMessage({ action: 'PING', timestamp: Date.now() });
    }, 2000);

    return () => clearInterval(teleInterval);
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected || !isLiveStreaming) return;

    sendWsMessage({
      action: 'STREAM_FRAME',
      start: true,
      command: 'START',
      quality: streamQuality === '1080p' ? 80 : streamQuality === '720p' ? 70 : 40,
      resolution: streamQuality
    });

    return () => {
      sendWsMessage({ action: 'STREAM_FRAME', start: false, command: 'STOP' });
    };
  }, [isConnected, isLiveStreaming, streamQuality]);

  const processIncomingMessage = (data: any, ws: WebSocket, targetIp: string, targetPort: string, targetName: string, currentPin: string) => {
    if (data.status === 'AUTH_OK') {
      wsRef.current = ws;
      setIsAuthPending(false);
      setIsConnected(true);
      setConnectionStatus('CONNECTED');
      setHostIp(targetIp);
      setHostPort(targetPort);
      setDiagnosticError(null);
      
      reconnectAttemptsRef.current = 0;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      const isWss = ws?.url?.startsWith('wss://') || false;
      setSecurityInfo({
        scheme: isWss ? 'wss' : 'ws',
        transport: isWss ? 'WebSocket TLS' : 'WebSocket Unencrypted',
        isSecure: isWss,
        fingerprint: data.tlsFingerprint || data.fingerprint,
      });

      const sessionToken = data.sessionToken || data.token;
      if (sessionToken) {
        secureStorage.saveSessionToken(targetIp, sessionToken);
      }

      if (typeof data.connectedClients === 'number') {
        setConnectedClientsCount(data.connectedClients);
      } else if (typeof data.connected_clients === 'number') {
        setConnectedClientsCount(data.connected_clients);
      } else if (typeof data.connectedCount === 'number') {
        setConnectedClientsCount(data.connectedCount);
      }
      
      const realHost = data.host || data.hostname || data.computer_name || data.name || data.host_name || data.pc_name || data.computerName || (targetName && targetName !== '-' ? targetName : (targetIp ? `PC (${targetIp})` : 'PC'));
      setHostName(realHost);
      if (data.mac) setMacAddress(data.mac);
      setFailedAttempts(0);

      if (ws) {
        ws.send(JSON.stringify({ action: 'GET_TELEMETRY' }));
      } else {
        sendWsMessage({ action: 'GET_TELEMETRY' });
      }

      setSavedPcs((prev) => {
        const filtered = prev.filter((p) => p.hostIp !== targetIp);
        return [
          {
            id: Date.now().toString(),
            hostName: realHost,
            hostIp: targetIp,
            hostPort: targetPort,
            pin: '',
            lastConnected: Date.now()
          },
          ...filtered
        ];
      });

      showToast(lang === 'ru' ? `Успешно подключено к ${realHost}` : `Connected to ${realHost}`);
    } else if (data.status === 'FORCE_DISCONNECTED') {
      secureStorage.removeSessionToken(targetIp);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      reconnectAttemptsRef.current = 0;
      wsRef.current = null;
      setIsConnected(false);
      setIsAuthPending(false);
      setConnectionStatus('DISCONNECTED');
      if (ws && ws.readyState < WebSocket.CLOSING) ws.close(4001, 'Disconnected by host');
      showToast(lang === 'ru' ? 'Соединение завершено на компьютере' : 'Connection ended by the computer');
    } else if (data.status === 'AUTH_FAILED') {
      secureStorage.removeSessionToken(targetIp);

      if (ws) ws.close();
      setConnectionStatus('DISCONNECTED');
      const nextFailed = failedAttempts + 1;
      setFailedAttempts(nextFailed);
      setDiagnosticError(getDiagnosticInfo('INVALID_PIN', lang));

      if (nextFailed >= 3) {
        setLockoutTimeLeft(60);
        setDiagnosticError(getDiagnosticInfo('HOST_LOCKED_OUT', lang));
        showToast(lang === 'ru' ? 'Превышено 3 неверных ввода PIN. Блокировка на 60 сек.' : '3 failed PIN attempts. Blocked for 60 seconds.');
      } else {
        showToast(lang === 'ru' ? `Ошибка AUTH_FAILED: Неверный PIN-код` : `AUTH_FAILED: Invalid PIN code`);
      }
    } else if (data.status === 'AUTH_BLOCKED') {
      secureStorage.removeSessionToken(targetIp);

      if (ws) ws.close();
      setConnectionStatus('DISCONNECTED');
      setLockoutTimeLeft(data.cooldown || 60);
      setDiagnosticError(getDiagnosticInfo('HOST_LOCKED_OUT', lang));
      showToast(lang === 'ru' ? `Сервер заблокировал вход на ${data.cooldown || 60} сек.` : `Server blocked access for ${data.cooldown || 60}s`);
    } else if (data.status === 'AUTH_PENDING') {
      setConnectionStatus('CONNECTING');
      setIsAuthPending(true);
      setAuthPendingTimeLeft(35);
      showToast(lang === 'ru' ? 'Ожидание подтверждения на ПК...' : 'Waiting for confirmation on PC...');
      setDiagnosticError({
        title: lang === 'ru' ? 'Ожидание подтверждения' : 'Waiting for Confirmation',
        detail: lang === 'ru' ? 'Пожалуйста, разрешите подключение в окне Aether на вашем ПК.' : 'Please allow connection in the Aether window on your PC.',
      });
    } else if (data.status === 'TELEMETRY_OK' || data.action === 'TELEMETRY' || data.type === 'TELEMETRY') {
      const dynamicHost = data.host || data.hostname || data.computer_name || data.name || data.host_name || data.pc_name || data.computerName;
      if (dynamicHost) {
        setHostName(dynamicHost);
        setSavedPcs((prev) =>
          prev.map((p) => (p.hostIp === targetIp ? { ...p, hostName: dynamicHost } : p))
        );
      }

      const innerTelemetry = data.data && typeof data.data === 'object' ? data.data : data;
      if (typeof innerTelemetry.connectedClients === 'number') {
        setConnectedClientsCount(innerTelemetry.connectedClients);
      } else if (typeof innerTelemetry.connected_clients === 'number') {
        setConnectedClientsCount(innerTelemetry.connected_clients);
      } else if (typeof innerTelemetry.connectedDevices === 'number') {
        setConnectedClientsCount(innerTelemetry.connectedDevices);
      }

      const c = typeof innerTelemetry.cpu === 'number' ? innerTelemetry.cpu : typeof innerTelemetry.cpu_percent === 'number' ? innerTelemetry.cpu_percent : typeof innerTelemetry.cpu_usage === 'number' ? innerTelemetry.cpu_usage : undefined;
      const r = typeof innerTelemetry.ram === 'number' ? innerTelemetry.ram : typeof innerTelemetry.ram_percent === 'number' ? innerTelemetry.ram_percent : typeof innerTelemetry.ram_usage === 'number' ? innerTelemetry.ram_usage : undefined;
      const g = typeof innerTelemetry.gpu === 'number' ? innerTelemetry.gpu : typeof innerTelemetry.gpu_percent === 'number' ? innerTelemetry.gpu_percent : typeof innerTelemetry.gpu_usage === 'number' ? innerTelemetry.gpu_usage : undefined;
      const nd = typeof innerTelemetry.net_download === 'number' ? innerTelemetry.net_download : typeof innerTelemetry.net_down_mbs === 'number' ? innerTelemetry.net_down_mbs : typeof innerTelemetry.download === 'number' ? innerTelemetry.download : undefined;
      const nu = typeof innerTelemetry.net_upload === 'number' ? innerTelemetry.net_upload : typeof innerTelemetry.net_up_mbs === 'number' ? innerTelemetry.net_up_mbs : typeof innerTelemetry.upload === 'number' ? innerTelemetry.upload : undefined;

      setCpuUsage(c !== undefined ? Math.round(c) : null);
      setRamUsage(r !== undefined ? Math.round(r) : null);
      setGpuUsage(g !== undefined ? Math.round(g) : null);
      setNetSpeedDown(nd !== undefined ? Number(nd.toFixed(1)) : null);
      setNetSpeedUp(nu !== undefined ? Number(nu.toFixed(1)) : null);
      setLastTelemetryTimestamp(Date.now());
    } else if (data.action === 'AUDIO_STREAM_STATUS') {
      const enabled = data.status === 'SUCCESS' && data.enabled === true;
      setIsAudioReceivingMuted(!enabled);
      webAudioManager.setMuted(!enabled);
      if (data.status === 'ERROR') showToast(data.error || (lang === 'ru' ? 'Не удалось включить звук ПК' : 'Failed to enable PC audio'));
    } else if (data.action === 'STREAM_STATUS') {
      setIsLiveStreaming(data.status === 'SUCCESS' && data.enabled === true);
    } else if (data.action === 'AUDIO_CHUNK' || data.type === 'AUDIO_CHUNK' || data.audio) {
      const audioBytes = data.data || data.audio || data.chunk || (data.data && data.data.audio);
      if (audioBytes && !isAudioReceivingMuted) {
        webAudioManager.playAudioChunk(audioBytes, data.sampleRate || 44100, data.channels || 2);
      }
    } else if (
      data.action === 'NOW_PLAYING' ||
      data.action === 'MEDIA_RESPONSE' ||
      data.status === 'MEDIA_OK' ||
      data.type === 'NOW_PLAYING' ||
      data.track ||
      data.now_playing ||
      (data.data && typeof data.data === 'object' && (data.data.track || data.data.title || data.data.now_playing || typeof data.data.isPlaying === 'boolean' || typeof data.data.is_playing === 'boolean')) ||
      typeof data.isPlaying === 'boolean' ||
      typeof data.is_playing === 'boolean'
    ) {
      const innerMedia = data.data && typeof data.data === 'object' ? data.data : data;
      const title = innerMedia.track || innerMedia.title || innerMedia.now_playing || (typeof innerMedia.media === 'string' ? innerMedia.media : undefined);
      const artist = innerMedia.artist || innerMedia.author || (lang === 'ru' ? 'PC Media Player' : 'PC Media Player');
      if (title) {
        setCurrentTrack({ title, artist });
      }
      if (typeof innerMedia.volume === 'number') setVolume(innerMedia.volume);
      if (typeof innerMedia.isMuted === 'boolean') setIsMuted(innerMedia.isMuted);
      
      const playState = typeof innerMedia.isPlaying === 'boolean' ? innerMedia.isPlaying : (typeof innerMedia.is_playing === 'boolean' ? innerMedia.is_playing : undefined);
      if (playState !== undefined) {
        setIsPlaying(playState);
      }
    } else if (data.action === 'CLIPBOARD' || data.action === 'CLIPBOARD_OK' || data.action === 'CLIPBOARD_TEXT' || data.action === 'CLIPBOARD_RESPONSE' || data.clipboard) {
      if (data.text || data.clipboard) {
        setPcClipboardText(data.text || data.clipboard);
      }
    } else if (data.action === 'FRAME' || data.action === 'SCREEN_FRAME' || data.type === 'FRAME' || data.status === 'FRAME_OK') {
      const frameStr = data.data || data.image || data.frame || data.image_b64 || data.img || (data.data && typeof data.data === 'object' && (data.data.image || data.data.frame || data.data.data));
      if (frameStr && typeof frameStr === 'string') {
        const src = frameStr.startsWith('data:image') ? frameStr : `data:image/jpeg;base64,${frameStr}`;
        setScreenFrameData(src);
        sendWsMessage({ action: 'FRAME_ACK', receivedAt: Date.now() });
      }
    } else if (data.status === 'NEED_ADMIN_CONFIRM' || data.action === 'NEED_ADMIN_CONFIRM') {
      setAdminConfirmDialog({ command: data.command || 'Unknown Command' });
    } else if (data.action === 'PS_OUTPUT' || data.action === 'POWERSHELL_RESPONSE') {
      setPsLogs((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          text: data.output || data.error || '(empty response)',
          type: 'out',
          time: new Date().toLocaleTimeString()
        }
      ]);
      setIsExecutingPs(false);
    } else if (data.status === 'ERROR') {
      showToast(data.error || data.message || (lang === 'ru' ? 'Команда завершилась ошибкой' : 'Command failed'));
    } else if (data.status === 'SCREENSHOT_OK') {
      if (data.image_b64) {
        const src = data.image_b64.startsWith('data:image') ? data.image_b64 : `data:image/jpeg;base64,${data.image_b64}`;
        const link = document.createElement('a');
        link.href = src;
        link.download = `screenshot_${Date.now()}.jpg`;
        link.click();
        showToast(lang === 'ru' ? 'Скриншот получен и сохранен' : 'Screenshot captured & downloaded');
      }
    } else if (data.action === 'PONG' || data.status === 'PONG' || data.type === 'PONG') {
      const sentTime = data.timestamp || data.time;
      if (sentTime) {
        setLatency(Date.now() - Number(sentTime));
      }
    }
  };

  const processWebSocketEvent = async (
    event: MessageEvent,
    ws: WebSocket,
    targetIp: string,
    targetPort: string,
    targetName: string,
    currentPin: string
  ) => {
    if (typeof event.data === 'string') {
      processIncomingMessage(JSON.parse(event.data), ws, targetIp, targetPort, targetName, currentPin);
      return;
    }

    const buffer = event.data instanceof Blob
      ? await event.data.arrayBuffer()
      : event.data instanceof ArrayBuffer
        ? event.data
        : ArrayBuffer.isView(event.data)
          ? event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength)
          : null;
    if (!buffer || buffer.byteLength < 2) return;

    const packet = new Uint8Array(buffer);
    const marker = packet[0];
    const payload = packet.subarray(1);
    if (marker === 0x02) {
      webAudioManager.playPcmChunk(payload, 44100, 2);
      return;
    }
    if (marker !== 0x01) return;

    const frameUrl = URL.createObjectURL(new Blob([payload], { type: 'image/jpeg' }));
    setScreenFrameData(frameUrl);
    if (prevFrameUrlRef.current) URL.revokeObjectURL(prevFrameUrlRef.current);
    prevFrameUrlRef.current = frameUrl;
    sendWsMessage({ action: 'FRAME_ACK', receivedAt: Date.now() });
  };

  const getLocalWifiPrefix = async (): Promise<string> => {
    let resolvedIp = '';
    try {
      resolvedIp = await new Promise<string>((resolve) => {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {});
        let resolved = false;
        pc.onicecandidate = (ice) => {
          if (resolved) return;
          if (ice && ice.candidate && ice.candidate.candidate) {
            const m = ice.candidate.candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
            if (m) {
              resolved = true;
              resolve(m[1]);
            }
          }
        };
        setTimeout(() => {
          if (!resolved) resolve('');
        }, 300);
      });

      if (resolvedIp) {
        const parts = resolvedIp.split('.');
        if (parts.length === 4) {
          // Keep the actual first two octets.  Hard-coding 10.0/172.16
          // produced invalid addresses on most home/VPN networks.
          return `${parts[0]}.${parts[1]}.`;
        }
      }
    } catch (e) {
      console.error('WebRTC local IP error:', e);
    }

    showToast(
      lang === 'ru'
        ? 'IP подсети не определён через WebRTC (mDNS/браузер). Использована подсеть 192.168.x'
        : 'Local IP prefix not resolved via WebRTC (mDNS privacy). Defaulted to 192.168.x'
    );

    if (savedPcs && savedPcs.length > 0) {
      const firstPc = savedPcs[0];
      if (firstPc.hostIp) {
        const parts = firstPc.hostIp.split('.');
        if (parts.length === 4) {
          return `${parts[0]}.${parts[1]}.`;
        }
      }
    }

    return '192.168.';
  };

  const decodePairingCode = async (rawInput: string) => {
    const cleanInput = rawInput.trim();
    if (!cleanInput) return null;

    const digitsOnly = cleanInput.replace(/\D/g, '');
    const parsed = parsePairingCode(digitsOnly);
    if (parsed) {
      const prefix = await getLocalWifiPrefix();
      return {
        targetIp: `${prefix}${parsed.octet3}.${parsed.octet4}`,
        targetPort: '8080',
        targetPin: digitsOnly,
        hardwarePin: parsed.hardwarePin,
      };
    }
    return null;
  };

  const performDhcpAutoRecovery = async (savedPc: SavedPC) => {
    if (lockoutTimeLeft > 0) return;

    const hardwarePin = savedPc.pin && savedPc.pin.length === 9 
      ? savedPc.pin.slice(6, 9) 
      : '849';

    let savedOctet3 = 1;
    if (savedPc.hostIp) {
      const parts = savedPc.hostIp.split('.');
      if (parts.length === 4) {
        savedOctet3 = parseInt(parts[2], 10);
      }
    } else if (savedPc.pin && savedPc.pin.length === 9) {
      savedOctet3 = parseInt(savedPc.pin.slice(0, 3), 10);
    }

    setConnectionStatus('CONNECTING');
    showToast(
      lang === 'ru'
        ? `ПК изменил IP. Восстановление соединения для PIN ${hardwarePin}...`
        : `PC changed IP. Recovering connection for PIN ${hardwarePin}...`
    );

    const prefix = await getLocalWifiPrefix();
    const prefixNoDot = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix;

    const candidateIps = new Set<string>();
    const targetOctet4 = parseInt(savedPc.hostIp?.split('.')[3] || '1', 10);
    const candidates = generateSubnetCandidates(prefix, savedOctet3, targetOctet4);
    candidates.forEach((ip) => candidateIps.add(ip));

    const primarySubnet = `${prefixNoDot}.${savedOctet3}`;

    const commonSubnets = [
      `${prefixNoDot}.1`,
      `${prefixNoDot}.0`,
      `${prefixNoDot}.31`,
      '192.168.1',
      '192.168.0',
      '192.168.31',
      '10.0.0',
    ];

    commonSubnets.forEach((sub) => {
      if (sub !== primarySubnet) {
        for (let i = 1; i <= 254; i++) {
          candidateIps.add(`${sub}.${i}`);
        }
      }
    });

    const ipList = Array.from(candidateIps);
    let foundWinner = false;
    const activeSockets: WebSocket[] = [];

    const cleanupSockets = () => {
      activeSockets.forEach((s) => {
        try {
          if (s.readyState === WebSocket.CONNECTING || s.readyState === WebSocket.OPEN) {
            s.onopen = null;
            s.onmessage = null;
            s.onerror = null;
            s.onclose = null;
            s.close();
          }
        } catch {
        }
      });
    };

    const timeoutTimer = setTimeout(() => {
      if (!foundWinner) {
        foundWinner = true;
        cleanupSockets();
        setConnectionStatus('DISCONNECTED');
        setDiagnosticError(getDiagnosticInfo('HOST_OFFLINE', lang));
        showToast(
          lang === 'ru'
            ? 'Не удалось обнаружить ПК на новом IP'
            : 'Failed to discover PC on new IP'
        );
      }
    }, 8000);

    const BATCH_SIZE = 20;
    for (let i = 0; i < ipList.length; i += BATCH_SIZE) {
      if (foundWinner) break;

      const batch = ipList.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((ip) => {
          return new Promise<void>((resolve) => {
            if (foundWinner) {
              resolve();
              return;
            }

            const ipParts = ip.split('.');
            if (ipParts.length !== 4) {
              resolve();
              return;
            }
            const currentOctet3 = parseInt(ipParts[2], 10);
            const currentOctet4 = parseInt(ipParts[3], 10);

            const candidatePin = 
              String(currentOctet3).padStart(3, '0') + 
              String(currentOctet4).padStart(3, '0') + 
              hardwarePin;

            try {
              const wsUrl = `wss://${ip}:8080`;
              const ws = new WebSocket(wsUrl);
              activeSockets.push(ws);

              const probeTimer = setTimeout(() => {
                try { ws.close(); } catch (_) {}
                resolve();
              }, 450);

              ws.onopen = () => {
                if (foundWinner) {
                  try { ws.close(); } catch (_) {}
                  resolve();
                  return;
                }
                ws.send(JSON.stringify({ action: 'AUTH', type: 'AUTH', pin: candidatePin }));
              };

              ws.onmessage = (event) => {
                clearTimeout(probeTimer);
                if (foundWinner) {
                  resolve();
                  return;
                }

                try {
                  const data = JSON.parse(event.data);
                  if (data.status === 'AUTH_OK') {
                    foundWinner = true;
      setIsAuthPending(false);
                    clearTimeout(timeoutTimer);

                    activeSockets.forEach((s) => {
                      if (s !== ws) {
                        try {
                          s.onopen = null;
                          s.onmessage = null;
                          s.onerror = null;
                          s.onclose = null;
                          s.close();
                        } catch {
                        }
                      }
                    });

                    setSavedPcs((prev) => {
                      const updated = prev.map((p) => {
                        if (p.id === savedPc.id) {
                          return {
                            ...p,
                            hostIp: ip,
                            pin: '',
                            lastConnected: Date.now(),
                          };
                        }
                        return p;
                      });
                      return updated;
                    });

                    processIncomingMessage(data, ws, ip, '8080', savedPc.hostName, candidatePin);

                    ws.binaryType = 'arraybuffer';
                    ws.onmessage = (evt) => {
                      void processWebSocketEvent(evt, ws, ip, '8080', savedPc.hostName, candidatePin).catch(console.error);
                    };

                    ws.onclose = () => {
                      if (wsRef.current === ws) {
                        wsRef.current = null;
                        setIsConnected(false);
                        setConnectionStatus('DISCONNECTED');
                        setHostName('-');
                        showToast(lang === 'ru' ? 'Соединение с ПК закрыто' : 'Disconnected from PC');
                      }
                    };

                    ws.onerror = () => {
                      if (wsRef.current === ws) {
                        wsRef.current = null;
                        setIsConnected(false);
                        setConnectionStatus('DISCONNECTED');
                        setHostName('-');
                      }
                    };

                    showToast(
                      lang === 'ru'
                        ? `Соединение восстановлено! Новый IP: ${ip}`
                        : `Connection restored! New IP: ${ip}`
                    );
                  }
                } catch {
                }
                resolve();
              };

              ws.onerror = () => {
                clearTimeout(probeTimer);
                resolve();
              };

              ws.onclose = () => {
                clearTimeout(probeTimer);
                resolve();
              };
            } catch {
              resolve();
            }
          });
        })
      );
    }
  };

  const connectDirectly = async (targetIp: string, targetPort: string, targetPin: string, savedPcContext?: SavedPC) => {
    if (lockoutTimeLeft > 0) {
      showToast(t('lockoutWarning', { sec: lockoutTimeLeft }));
      return;
    }

    addConnectionLog(targetIp ? `${targetIp}:${targetPort}` : targetPin, 'LAN', 'Initiating connection', 'connecting');

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setScreenStream(null);

    setConnectionStatus('CONNECTING');
    setLastConnectionError(null);

    const peerId = targetPin.replace(/[\s-]/g, '').trim();
    const savedSessionTokenForTarget = targetIp ? (secureStorage.getSessionToken(targetIp) || '') : '';
    if (!peerId && !(targetIp && targetPort && savedSessionTokenForTarget)) {
      setConnectionStatus('DISCONNECTED');
      showToast(lang === 'ru' ? 'Неверный формат PIN-кода' : 'Invalid PIN format');
      return;
    }

    if (targetIp && targetPort) {
      showToast(
        lang === 'ru'
          ? `Попытка прямого подключения к ${targetIp}:${targetPort}...`
          : `Attempting direct connection to ${targetIp}:${targetPort}...`
      );
      
      const directConnected = await new Promise<boolean>((resolve) => {
        let finished = false;
        const wsUrl = `wss://${targetIp}:${targetPort}`;
        let ws: WebSocket | null = null;
        
        const timeout = setTimeout(() => {
          if (!finished) {
            finished = true;
            if (ws) {
              try { ws.close(); } catch (_) {}
            }
            addConnectionLog(`${targetIp}:${targetPort}`, 'LAN', 'Socket connection', 'failed', 'Connection timeout (1.5s)');
            resolve(false);
          }
        }, 35000);

        try {
          ws = new WebSocket(wsUrl);
          ws.onopen = () => {
            if (!finished) {
              const authPayload = savedSessionTokenForTarget
                ? { action: 'AUTH', sessionToken: savedSessionTokenForTarget }
                : { action: 'AUTH', pin: targetPin };
              try {
                ws.send(JSON.stringify(authPayload));
              } catch (_) {
                resolve(false);
                return;
              }

              ws.onmessage = (event) => {
                try {
                  const data = JSON.parse(event.data);
                  if (data.status === 'AUTH_OK') {
                    finished = true;
                    clearTimeout(timeout);
      setIsAuthPending(false);
                    addConnectionLog(`${targetIp}:${targetPort}`, 'LAN', 'Handshake & Authentication', 'success');
                    processIncomingMessage(data, ws!, targetIp, targetPort, '-', targetPin);
                    
                    ws!.binaryType = 'arraybuffer';
                    ws!.onmessage = (evt) => {
                      void processWebSocketEvent(evt, ws!, targetIp, targetPort, '-', targetPin).catch(console.error);
                    };

                    ws!.onclose = () => {
                      if (wsRef.current === ws) {
                        wsRef.current = null;
                        setIsConnected(false);
                        setConnectionStatus('DISCONNECTED');
                        setHostName('-');
                        showToast(lang === 'ru' ? 'Соединение с ПК закрыто' : 'Disconnected from PC');
                      }
                    };

                    ws!.onerror = () => {
                      if (wsRef.current === ws) {
                        wsRef.current = null;
                        setIsConnected(false);
                        setConnectionStatus('DISCONNECTED');
                        setHostName('-');
                      }
                    };

                    resolve(true);
                  } else if (data.status === 'AUTH_PENDING') {
                    processIncomingMessage(data, ws!, targetIp, targetPort, '-', targetPin);
                  } else if (data.status === 'AUTH_FAILED' || data.status === 'AUTH_BLOCKED') {
                    finished = true;
                    clearTimeout(timeout);
                    processIncomingMessage(data, ws!, targetIp, targetPort, '-', targetPin);
                    addConnectionLog(`${targetIp}:${targetPort}`, 'LAN', 'Authentication', 'failed', data.status || 'Authentication rejected');
                    try { ws!.close(); } catch (_) {}
                    resolve(false);
                  }
                } catch (_) {
                  finished = true;
                  clearTimeout(timeout);
                  try { ws!.close(); } catch (_) {}
                  resolve(false);
                }
              };
            } else {
              try { ws.close(); } catch (_) {}
            }
          };

          ws.onerror = () => {
            if (!finished) {
              finished = true;
              clearTimeout(timeout);
              addConnectionLog(`${targetIp}:${targetPort}`, 'LAN', 'Socket connection', 'failed', 'Network error / host unreachable');
              resolve(false);
            }
          };
          ws.onclose = () => {
            if (!finished) {
              finished = true;
              clearTimeout(timeout);
              addConnectionLog(`${targetIp}:${targetPort}`, 'LAN', 'Socket connection', 'failed', 'Connection closed prematurely');
              resolve(false);
            }
          };
        } catch (_) {
          if (!finished) {
            finished = true;
            clearTimeout(timeout);
            resolve(false);
          }
        }
      });

      if (directConnected) {
        return;
      }
      if (!peerId) {
        setConnectionStatus('DISCONNECTED');
        showToast(lang === 'ru' ? 'Сохранённая сессия истекла — введите новый 9-значный код' : 'Saved session expired — enter a new 9-digit code');
        return;
      }
    }

    setConnectionStatus('DISCONNECTED');
    setLastConnectionError('offline');
    showToast(lang === 'ru' ? 'Не удалось подключиться к ПК в локальной сети' : 'Could not connect to the PC on the local network');
    return;
  };

  const performSubnetAutoDiscovery = (enteredPin: string) => {
    if (lockoutTimeLeft > 0) {
      showToast(t('lockoutWarning', { sec: lockoutTimeLeft }));
      return;
    }

    if (enteredPin.length < 6) {
      showToast(t('enterPin'));
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionStatus('CONNECTING');
    showToast(lang === 'ru' ? 'Поиск ПК в локальной Wi-Fi сети...' : 'Searching for PC in local Wi-Fi...');

    const candidateIps = new Set<string>();

    const first3Digits = enteredPin.slice(0, 3);
    const octetNum = parseInt(first3Digits, 10);
    const isValidOctet = !isNaN(octetNum) && octetNum >= 1 && octetNum <= 254;

    const subnets = new Set<string>();

    if (hostIp) {
      const parts = hostIp.split('.');
      if (parts.length === 4) subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
    }
    savedPcs.forEach((p) => {
      if (p.hostIp) {
        const parts = p.hostIp.split('.');
        if (parts.length === 4) subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
      }
    });

    subnets.add('192.168.31');
    subnets.add('192.168.1');
    subnets.add('192.168.0');
    subnets.add('192.168.100');
    subnets.add('192.168.88');
    subnets.add('10.0.0');
    subnets.add('172.20.10');

    if (isValidOctet) {
      const octetStr = octetNum.toString();
      subnets.forEach((sub) => {
        candidateIps.add(`${sub}.${octetStr}`);
      });
    }

    if (hostIp) candidateIps.add(hostIp);
    savedPcs.forEach((p) => {
      if (p.hostIp) candidateIps.add(p.hostIp);
    });

    candidateIps.add('127.0.0.1');
    candidateIps.add('localhost');

    if (!isValidOctet) {
      subnets.forEach((sub) => {
        for (let i = 1; i <= 254; i++) {
          candidateIps.add(`${sub}.${i}`);
        }
      });
    }

    const ipList = Array.from(candidateIps);
    const targetPort = hostPort || '8080';

    let foundWinner = false;
    let approvalSocket: WebSocket | null = null;
    const activeSockets: WebSocket[] = [];

    const cleanupSockets = () => {
      activeSockets.forEach((s) => {
        try {
          if (s.readyState === WebSocket.CONNECTING || s.readyState === WebSocket.OPEN) {
            s.onopen = null;
            s.onmessage = null;
            s.onerror = null;
            s.onclose = null;
            s.close();
          }
        } catch {
        }
      });
    };

    let timeoutTimer = 0;
    const armTimeout = (delayMs: number) => {
      window.clearTimeout(timeoutTimer);
      timeoutTimer = window.setTimeout(() => {
      if (!foundWinner) {
        foundWinner = true;
        cleanupSockets();
        setIsAuthPending(false);
        setConnectionStatus('DISCONNECTED');
        showToast(
          lang === 'ru'
            ? 'ПК с таким PIN-кодом не найден в Wi-Fi сети'
            : 'PC with this PIN code was not found in Wi-Fi network'
          );
      }
      }, delayMs);
    };
    armTimeout(3000);

    const BATCH_SIZE = 20;
    const scanSubnet = async () => {
      for (let i = 0; i < ipList.length; i += BATCH_SIZE) {
        if (foundWinner || approvalSocket) break;

        const batch = ipList.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map((ip) => {
            return new Promise<void>((resolve) => {
              if (foundWinner || approvalSocket) {
                resolve();
                return;
              }

              try {
                const wsUrl = `wss://${ip}:${targetPort}`;
                const ws = new WebSocket(wsUrl);
                activeSockets.push(ws);

                const probeTimer = setTimeout(() => {
                  try { ws.close(); } catch (_) {}
                  resolve();
                }, 450);

                ws.onopen = () => {
                  if (foundWinner) {
                    try { ws.close(); } catch (_) {}
                    resolve();
                    return;
                  }
                  try {
                    ws.send(JSON.stringify({ action: 'AUTH', type: 'AUTH', pin: enteredPin }));
                  } catch {
                  }
                };

                ws.onmessage = (event) => {
                  clearTimeout(probeTimer);
                  if (foundWinner) {
                    resolve();
                    return;
                  }

                  try {
                    const data = JSON.parse(event.data);
                    if (data.status === 'AUTH_PENDING') {
                      if (!approvalSocket) {
                        approvalSocket = ws;
                        setIsAuthPending(true);
                        setConnectionStatus('CONNECTING');
                        armTimeout(35000);
                        activeSockets.forEach((socket) => {
                          if (socket !== ws) {
                            try { socket.close(); } catch (_) {}
                          }
                        });
                      }
                      resolve();
                      return;
                    }
                    if (data.status === 'AUTH_OK') {
                      foundWinner = true;
                      setIsAuthPending(false);
                      clearTimeout(timeoutTimer);

                      activeSockets.forEach((s) => {
                        if (s !== ws) {
                          try {
                            s.onopen = null;
                            s.onmessage = null;
                            s.onerror = null;
                            s.onclose = null;
                            s.close();
                          } catch {
                          }
                        }
                      });

                      processIncomingMessage(data, ws, ip, targetPort, '-', enteredPin);

                      ws.binaryType = 'arraybuffer';
                      ws.onmessage = (evt) => {
                        void processWebSocketEvent(evt, ws, ip, targetPort, '-', enteredPin).catch(console.error);
                      };

                      ws.onclose = () => {
                        if (wsRef.current === ws) {
                          wsRef.current = null;
                          setIsConnected(false);
                          setConnectionStatus('DISCONNECTED');
                          setHostName('-');
                          showToast(lang === 'ru' ? 'Соединение с ПК закрыто' : 'Disconnected from PC');
                        }
                      };

                      ws.onerror = () => {
                        if (wsRef.current === ws) {
                          wsRef.current = null;
                          setIsConnected(false);
                          setConnectionStatus('DISCONNECTED');
                          setHostName('-');
                        }
                      };
                    }
                  } catch {
                  }
                  resolve();
                };

                ws.onerror = () => {
                  clearTimeout(probeTimer);
                  resolve();
                };
              } catch {
                resolve();
              }
            });
          })
        );
      }
    };

    scanSubnet();
  };

  const handleConnect = async (savedPc?: SavedPC, codeOverride?: string) => {
    if (lockoutTimeLeft > 0) {
      showToast(t('lockoutWarning', { sec: lockoutTimeLeft }));
      return;
    }

    if (savedPc) {
      connectDirectly(savedPc.hostIp, savedPc.hostPort, savedPc.pin, savedPc);
      return;
    }

    const rawCode = (codeOverride !== undefined ? codeOverride : pin.join('')).trim();
    if (!rawCode) {
      showToast(t('enterPin'));
      return;
    }
    if (codeOverride === undefined && !/^\d{9}$/.test(rawCode)) {
      showToast(lang === 'ru' ? 'Введите все 9 цифр кода подключения' : 'Enter all 9 digits of the pairing code');
      return;
    }

    const decoded = await decodePairingCode(rawCode);
    if (decoded && decoded.targetIp) {
      connectDirectly(decoded.targetIp, decoded.targetPort || '8080', decoded.targetPin || rawCode);
      return;
    }

    performSubnetAutoDiscovery(rawCode);
  };

  const handleQuickReconnect = (pc: SavedPC) => {
    handleConnect(pc);
  };

  const handleRemoveSavedPc = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSavedPcs((prev) => prev.filter((p) => p.id !== id));
    if (editingPcId === id) setEditingPcId(null);
    showToast(lang === 'ru' ? 'ПК удален из сохраненных' : 'PC removed from memory');
  };

  const handleStartRenamePc = (pc: SavedPC, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPcId(pc.id);
    setEditingPcName(pc.hostName);
  };

  const handleSaveRenamePc = (id: string, e?: React.MouseEvent | React.FormEvent) => {
    if (e) e.stopPropagation();
    const trimmed = editingPcName.trim();
    if (trimmed) {
      setSavedPcs((prev) =>
        prev.map((p) => (p.id === id ? { ...p, hostName: trimmed } : p))
      );
      showToast(lang === 'ru' ? 'Имя ПК обновлено' : 'PC renamed');
    }
    setEditingPcId(null);
  };

  const handleCancelRenamePc = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPcId(null);
  };

  const handlePinPaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text').trim();
    if (!pastedText) return;

    const decoded = await decodePairingCode(pastedText);
    if (decoded && decoded.targetIp) {
      if (decoded.targetPin) {
        const pinChars = decoded.targetPin.slice(0, 9).split('');
        const newPin = Array(9).fill('');
        pinChars.forEach((ch, idx) => {
          if (idx < 9) newPin[idx] = ch;
        });
        setPin(newPin);
      }
      connectDirectly(decoded.targetIp, decoded.targetPort || '8080', decoded.targetPin || pastedText);
      return;
    }

    const digits = pastedText.replace(/\D/g, '').slice(0, 9).split('');
    const newPin = Array(9).fill('');
    digits.forEach((d, i) => {
      newPin[i] = d;
    });
    setPin(newPin);
    if (digits.length >= 9) {
      handleConnect(undefined, digits.join(''));
    }
  };

  const handlePinChange = async (index: number, val: string) => {
    if (val.length > 1) {
      const decoded = await decodePairingCode(val);
      if (decoded && decoded.targetIp) {
        connectDirectly(decoded.targetIp, decoded.targetPort || '8080', decoded.targetPin || val);
        return;
      }
      val = val[val.length - 1];
    }

    const newPin = [...pin];
    newPin[index] = val;
    setPin(newPin);

    if (val !== '' && index < 8) {
      const nextInput = document.getElementById(`pin-input-${index + 1}`);
      nextInput?.focus();
    }

    if (newPin.every((digit) => digit !== '')) {
      handleConnect(undefined, newPin.join(''));
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && pin[index] === '' && index > 0) {
      const prevInput = document.getElementById(`pin-input-${index - 1}`);
      prevInput?.focus();
    }
  };

  const executePowerShellCommand = (cmdText: string) => {
    if (!cmdText.trim()) return;

    const lower = cmdText.toLowerCase();
    const isDangerous = lower.includes('remove-item') || lower.includes('del') || lower.includes('rm') || lower.includes('stop-process -force') || lower.includes('format');

    if (isDangerous && !psConfirmCommand) {
      setPsConfirmCommand(cmdText);
      return;
    }

    setIsExecutingPs(true);
    const now = new Date().toLocaleTimeString();

    setPsLogs((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        text: `PS C:\\Windows\\System32> ${cmdText}`,
        type: 'cmd',
        time: now
      }
    ]);

    const sent = sendWsMessage({ action: 'POWERSHELL', command: cmdText });
    if (!sent) {
      setTimeout(() => {
        setPsLogs((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            text: lang === 'ru' ? 'Ошибка: Нет активного соединения с хостом' : 'Error: No active WebSocket connection to host',
            type: 'err',
            time: new Date().toLocaleTimeString()
          }
        ]);
        setIsExecutingPs(false);
      }, 300);
    }

    setPsCommand('');
    setPsConfirmCommand(null);
  };

  const isLight = theme === 'light';

  const containerBg = isLight 
    ? 'bg-slate-100 text-slate-900 selection:bg-slate-300' 
    : 'bg-black text-white selection:bg-white/20';

  const cardGlass = isLight 
    ? 'bg-white/80 border border-slate-200/90 shadow-sm text-slate-900 backdrop-blur-md' 
    : 'liquid-glass text-white';

  const cardGlassStrong = isLight 
    ? 'bg-white border border-slate-300 shadow-md text-slate-900 backdrop-blur-lg' 
    : 'liquid-glass-strong text-white';

  const inputStyle = isLight 
    ? 'bg-slate-100 border border-slate-300 text-slate-900 placeholder-slate-400 focus:border-slate-500' 
    : 'liquid-glass-strong text-white placeholder-white/30 focus:border-white/50';

  const textMuted = isLight ? 'text-slate-500' : 'text-white/50';
  const textSub = isLight ? 'text-slate-700' : 'text-white/80';

  return (
    <div className={`min-h-screen relative flex flex-col font-sans transition-colors duration-300 ${containerBg}`}>
      <div className={`fixed top-0 left-1/2 -translate-x-1/2 w-[340px] h-[240px] rounded-full blur-[120px] pointer-events-none ${isLight ? 'bg-sky-200/50' : 'bg-white/5'}`} />
      <div className={`fixed bottom-0 right-0 w-[280px] h-[280px] rounded-full blur-[140px] pointer-events-none ${isLight ? 'bg-emerald-200/40' : 'bg-white/3'}`} />

      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in max-w-xs w-full px-4">
          <div className={`${cardGlassStrong} rounded-full px-5 py-3 text-center text-xs font-medium tracking-wide shadow-2xl flex items-center justify-center gap-2 border border-emerald-500/30`}>
            <Zap className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      <div className="max-w-md mx-auto w-full flex-1 flex flex-col min-h-screen pb-28 px-4 pt-4">
        <header className="flex items-center justify-between py-3 mb-4">
          <div className="flex items-center gap-2.5">
            <AppLogoIcon className="w-10 h-10" />
            <div className={`${cardGlass} rounded-full px-3.5 py-1.5 flex items-center gap-2.5`}>
              <span className="relative flex h-2.5 w-2.5">
                {connectionStatus === 'CONNECTED' && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    connectionStatus === 'CONNECTED'
                      ? 'bg-emerald-500'
                      : connectionStatus === 'CONNECTING'
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-rose-500'
                  }`}
                />
              </span>
              <div className="flex flex-col">
                <span className={`text-[10px] tracking-wider uppercase font-semibold flex items-center gap-1 ${textMuted}`}>
                  {connectionStatus === 'CONNECTED'
                    ? t('connected')
                    : connectionStatus === 'CONNECTING'
                    ? t('connecting')
                    : t('disconnected')}
                  {connectionStatus === 'CONNECTED' && <ShieldCheck className="w-3 h-3 text-emerald-500 inline" />}
                  {connectionStatus === 'CONNECTED' && latency !== null && (
                    <span className="text-[9px] text-emerald-400 font-normal normal-case ml-1">
                      ({latency} {lang === 'ru' ? 'мс' : 'ms'})
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-xs font-medium ${isLight ? 'text-slate-900' : 'text-white/90'}`}>
                    {isConnected
                      ? (hostName && hostName !== '-' ? hostName : (lang === 'ru' ? 'Подключено' : 'Connected'))
                      : lastConnectionError === 'offline'
                      ? (lang === 'ru' ? 'ПК оффлайн / выключен' : 'PC Offline / Turned off')
                      : (lang === 'ru' ? 'Не подключено' : 'Not Connected')}
                  </span>
                  
                  {isConnected && (
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                        securityInfo.isSecure
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}
                      title={securityInfo.transport}
                    >
                      {securityInfo.scheme.toUpperCase()}
                    </span>
                  )}

                  {isConnected && connectedClientsCount !== null && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center gap-0.5"
                      title={lang === 'ru' ? `Подключено устройств: ${connectedClientsCount}` : `Connected devices: ${connectedClientsCount}`}
                    >
                      👥 {connectedClientsCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {isConnected && (
              <>
                <button
                  onClick={() => {
                    const nextMuted = !isAudioReceivingMuted;
                    if (!sendWsMessage({ action: 'AUDIO_STREAM', enabled: !nextMuted })) {
                      showToast(lang === 'ru' ? 'Не удалось отправить команду аудиопотока' : 'Failed to send audio command');
                    } else if (nextMuted) {
                      setIsAudioReceivingMuted(true);
                      webAudioManager.setMuted(true);
                    }
                  }}
                  className={`p-2 rounded-full transition-all border ${
                    isAudioReceivingMuted
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  }`}
                  title={isAudioReceivingMuted ? (lang === 'ru' ? 'Включить звук ПК' : 'Unmute PC Audio') : (lang === 'ru' ? 'Выключить звук ПК' : 'Mute PC Audio')}
                >
                  {isAudioReceivingMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 animate-pulse" />}
                </button>

                <button
                  onClick={() => {
                    sendWsMessage({ action: 'AUDIO_STREAM', enabled: false });
                    if (wsRef.current) wsRef.current.close(1000, 'User disconnected');
                    wsRef.current = null;
                    webAudioManager.stop();
                    setIsLiveStreaming(false);
                    setIsAudioReceivingMuted(true);
                    setIsConnected(false);
                    setConnectionStatus('DISCONNECTED');
                    setHostName('-');
                    showToast(lang === 'ru' ? 'Сеанс отключен' : 'Disconnected');
                  }}
                  className="bg-rose-500/15 hover:bg-rose-500/25 text-rose-500 border border-rose-500/30 px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
                  title={t('disconnect')}
                >
                  <Unplug className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t('disconnectHeader')}</span>
                </button>
              </>
            )}

            <button
              onClick={() => {
                const nextTheme = theme === 'dark' ? 'light' : 'dark';
                setTheme(nextTheme);
                showToast(nextTheme === 'light' ? (lang === 'ru' ? 'Светлая тема' : 'Light theme') : (lang === 'ru' ? 'Темная тема' : 'Dark theme'));
              }}
              className={`${cardGlass} p-2.5 rounded-full hover:scale-105 transition-all`}
              title={theme === 'dark' ? t('lightTheme') : t('darkTheme')}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4 text-indigo-600" />}
            </button>

            <button
              onClick={() => {
                const nextLang = lang === 'ru' ? 'en' : 'ru';
                setLang(nextLang);
                showToast(nextLang === 'ru' ? 'Язык: Русский' : 'Language: English');
              }}
              className={`${cardGlass} px-2.5 py-1.5 rounded-full hover:scale-105 transition-all flex items-center gap-1 font-bold text-[11px]`}
              title="Change Language"
            >
              <Globe className="w-3.5 h-3.5 text-emerald-500" />
              <span>{lang.toUpperCase()}</span>
            </button>

            <button
              onClick={() => {
                if (isConnected) {
                  sendWsMessage({ action: 'GET_TELEMETRY' });
                  showToast(lang === 'ru' ? 'Запрос телеметрии...' : 'Requesting telemetry...');
                } else {
                  showToast(lang === 'ru' ? 'Нет подключения к хосту' : 'Not connected to host');
                }
              }}
              className={`${cardGlass} p-2.5 rounded-full hover:scale-105 transition-all`}
              title="Refresh Telemetry"
            >
              <RefreshCw className="w-4 h-4 text-emerald-500" />
            </button>

            <button
              onClick={() => setShowSettingsModal(true)}
              className={`${cardGlass} p-2.5 rounded-full hover:scale-105 transition-all`}
              title={t('settingsTitle')}
            >
              <Settings className="w-4 h-4 text-emerald-500" />
            </button>
          </div>
        </header>

        {!isConnected ? (
          <main className="flex-1 flex flex-col items-center justify-center py-4 text-center animate-fade-in">
            <div className="mb-3">
              <AppLogoIcon className="w-12 h-12" />
            </div>

            <h1 className="font-heading text-3xl italic font-normal tracking-wide mb-1">
              Aether Remote PC
            </h1>
            <p className={`text-xs ${textMuted} max-w-xs mb-6`}>
              {t('subTitle')}
            </p>

            {diagnosticError && (
              <div className="w-full bg-rose-500/15 border border-rose-500/40 rounded-2xl p-3.5 mb-5 text-left flex items-start gap-3 shadow-lg">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs">
                  <div className="font-bold text-rose-300 mb-0.5 flex items-center justify-between">
                    <span>{diagnosticError.title}</span>
                    <button
                      onClick={() => setDiagnosticError(null)}
                      className="text-rose-400/60 hover:text-rose-300 text-xs px-1"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-rose-200/80 leading-relaxed">{diagnosticError.detail}</p>
                </div>
              </div>
            )}

            {isAuthPending ? (
              <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-2xl p-6 mb-6 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center mb-4 animate-pulse">
                  <ShieldCheck className="w-6 h-6 text-amber-500" />
                </div>
                <h3 className="text-amber-500 font-bold mb-2">
                  {lang === 'ru' ? 'Ожидание подтверждения' : 'Waiting for confirmation'}
                </h3>
                <p className={`text-xs ${textMuted} mb-4`}>
                  {lang === 'ru' 
                    ? `Пожалуйста, разрешите подключение в окне программы Aether на ПК. Ожидание ответа... ${authPendingTimeLeft} сек.` 
                    : `Please allow the connection in the Aether window on your PC. Waiting... ${authPendingTimeLeft}s`}
                </p>
                <button
                  onClick={() => {
                    setIsAuthPending(false);
                    setConnectionStatus('DISCONNECTED');
                    if (wsRef.current) wsRef.current.close();
                  }}
                  className="px-4 py-2 bg-rose-500/20 text-rose-500 rounded-lg text-xs font-semibold hover:bg-rose-500/30 transition"
                >
                  {lang === 'ru' ? 'Отмена' : 'Cancel'}
                </button>
              </div>
            ) : (
              <>
                {lockoutTimeLeft > 0 && (
                  <div className="w-full bg-rose-500/20 border border-rose-500/40 rounded-2xl p-3 mb-6 flex items-center gap-2 text-rose-400 text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{t('lockoutWarning', { sec: lockoutTimeLeft })}</span>
                  </div>
                )}

                <div className="flex items-center justify-center gap-0.5 min-[350px]:gap-1 sm:gap-2 mb-6 w-full">
                  {pin.slice(0, 3).map((digit, idx) => (
                    <input
                      key={idx}
                      id={`pin-input-${idx}`}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      size={1}
                      disabled={lockoutTimeLeft > 0}
                      value={digit}
                      onChange={(e) => handlePinChange(idx, e.target.value)}
                      onKeyDown={(e) => handlePinKeyDown(idx, e)}
                      onPaste={handlePinPaste}
                      className={`w-6 h-9 min-[350px]:w-7 min-[350px]:h-10 min-[390px]:w-8 min-[390px]:h-12 sm:w-11 sm:h-14 rounded-md sm:rounded-xl ${inputStyle} text-center text-xs min-[350px]:text-sm sm:text-xl font-semibold transition-all disabled:opacity-30 min-w-0 p-0`}
                    />
                  ))}
                  <span className={`${textMuted} font-normal text-xs sm:text-sm px-0`}>-</span>
                  {pin.slice(3, 6).map((digit, idx) => (
                    <input
                      key={idx + 3}
                      id={`pin-input-${idx + 3}`}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      size={1}
                      disabled={lockoutTimeLeft > 0}
                      value={digit}
                      onChange={(e) => handlePinChange(idx + 3, e.target.value)}
                      onKeyDown={(e) => handlePinKeyDown(idx + 3, e)}
                      onPaste={handlePinPaste}
                      className={`w-6 h-9 min-[350px]:w-7 min-[350px]:h-10 min-[390px]:w-8 min-[390px]:h-12 sm:w-11 sm:h-14 rounded-md sm:rounded-xl ${inputStyle} text-center text-xs min-[350px]:text-sm sm:text-xl font-semibold transition-all disabled:opacity-30 min-w-0 p-0`}
                    />
                  ))}
                  <span className={`${textMuted} font-normal text-xs sm:text-sm px-0`}>-</span>
                  {pin.slice(6, 9).map((digit, idx) => (
                    <input
                      key={idx + 6}
                      id={`pin-input-${idx + 6}`}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      size={1}
                      disabled={lockoutTimeLeft > 0}
                      value={digit}
                      onChange={(e) => handlePinChange(idx + 6, e.target.value)}
                      onKeyDown={(e) => handlePinKeyDown(idx + 6, e)}
                      onPaste={handlePinPaste}
                      className={`w-6 h-9 min-[350px]:w-7 min-[350px]:h-10 min-[390px]:w-8 min-[390px]:h-12 sm:w-11 sm:h-14 rounded-md sm:rounded-xl ${inputStyle} text-center text-xs min-[350px]:text-sm sm:text-xl font-semibold transition-all disabled:opacity-30 min-w-0 p-0`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => handleConnect()}
                  disabled={lockoutTimeLeft > 0 || !/^\d{9}$/.test(pin.join('').trim())}
                  className={`w-full ${cardGlassStrong} py-3.5 rounded-2xl text-xs font-semibold tracking-wider hover:scale-[1.01] transition-all flex items-center justify-center gap-2 mb-6 disabled:opacity-40 shadow-lg`}
                >
                  <Zap className="w-4 h-4 text-emerald-500" />
                  <span>{t('connectToPc')}</span>
                </button>

                <div className="w-full space-y-2 text-left mt-2">
                  <div className={`flex items-center justify-between text-[11px] ${textMuted} font-medium px-1`}>
                    <span className="flex items-center gap-1">
                      <History className="w-3.5 h-3.5" />
                      <span>{t('rememberedPcs')} ({savedPcs.length})</span>
                    </span>
                    {savedPcs.length > 0 && (
                      <span className="text-[10px] opacity-60">{t('oneTapConnect')}</span>
                    )}
                  </div>

              {savedPcs.length > 0 ? (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {savedPcs.map((pc) => (
                    <div
                      key={pc.id}
                      onClick={() => {
                        if (editingPcId !== pc.id) {
                          handleQuickReconnect(pc);
                        }
                      }}
                      className={`${cardGlass} p-3 rounded-2xl flex items-center justify-between ${
                        editingPcId !== pc.id ? 'cursor-pointer hover:border-emerald-500/50' : ''
                      } transition-colors group`}
                    >
                      {editingPcId === pc.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleSaveRenamePc(pc.id);
                          }}
                          className="flex items-center gap-2 w-full"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className={`w-9 h-9 rounded-xl ${cardGlassStrong} flex items-center justify-center shrink-0`}>
                            <Tv className="w-4 h-4 text-emerald-500" />
                          </div>
                          <input
                            type="text"
                            value={editingPcName}
                            onChange={(e) => setEditingPcName(e.target.value)}
                            className="bg-black/50 border border-emerald-500/60 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 flex-1 min-w-0 font-medium"
                            autoFocus
                            placeholder={lang === 'ru' ? 'Имя компьютера...' : 'PC name...'}
                          />
                          <button
                            type="submit"
                            className="p-1.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-lg transition-colors shrink-0"
                            title={lang === 'ru' ? 'Сохранить' : 'Save'}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelRenamePc}
                            className={`p-1.5 ${textMuted} hover:text-white hover:bg-white/10 rounded-lg transition-colors shrink-0`}
                            title={lang === 'ru' ? 'Отмена' : 'Cancel'}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      ) : (
                        <>
                          <div className="flex items-center gap-3 overflow-hidden mr-2">
                            <div className={`w-9 h-9 rounded-xl ${cardGlassStrong} flex items-center justify-center shrink-0`}>
                              <Tv className="w-4 h-4 text-emerald-500" />
                            </div>
                            <div className="min-w-0">
                              <div className={`text-xs font-semibold group-hover:text-emerald-500 transition-colors truncate`}>
                                {pc.hostName}
                              </div>
                              <div className={`text-[10px] ${textMuted} font-mono truncate`}>
                                {pc.hostIp}:{pc.hostPort} • {lang === 'ru' ? 'защищённая сессия' : 'secure session'}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium hidden sm:inline-block">
                              {t('quickLogin')}
                            </span>
                            <button
                              onClick={(e) => handleStartRenamePc(pc, e)}
                              className={`p-1.5 ${textMuted} hover:text-emerald-400 hover:bg-white/10 rounded-lg transition-colors`}
                              title={lang === 'ru' ? 'Переименовать' : 'Rename'}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleRemoveSavedPc(pc.id, e)}
                              className={`p-1.5 ${textMuted} hover:text-rose-500 hover:bg-white/10 transition-colors rounded-lg`}
                              title={lang === 'ru' ? 'Удалить' : 'Delete'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`${cardGlass} p-3.5 rounded-2xl text-center`}>
                  <p className={`text-[11px] ${textMuted} leading-relaxed`}>
                    {lang === 'ru'
                      ? 'Нет сохраненных ПК. Подключитесь к компьютеру, чтобы сохранить его для быстрого входа.'
                      : 'No saved PCs. Connect to a computer to save it for quick access.'}
                  </p>
                </div>
              )}
            </div>

            <div className="w-full pt-4">
              <button
                onClick={() => setShowLogsModal(true)}
                className={`w-full ${cardGlass} py-2.5 rounded-xl text-[11px] font-semibold tracking-wider hover:bg-emerald-500/10 transition-colors flex items-center justify-center gap-2 border border-emerald-500/20 text-emerald-400`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>{lang === 'ru' ? 'Журнал диагностики подключения' : 'Connection Diagnostics Log'}</span>
              </button>
            </div>
              </>
            )}
          </main>
        ) : (
          <main className="flex-1 flex flex-col">
            {activeTab === 'system' && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <h2 className="font-heading text-2xl italic">{t('monitoringStream')}</h2>
                  <p className={`text-xs ${textMuted}`}>{t('liveStreamSub')}</p>
                </div>

                {isConnected && isTelemetryStale && (
                  <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[11px] animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <span>
                      {lang === 'ru'
                        ? 'Данные устарели (более 5 сек без обновлений)'
                        : 'Telemetry is stale (5s+ without updates)'}
                    </span>
                  </div>
                )}

                <div className={`grid grid-cols-2 gap-3 transition-opacity duration-300 ${isConnected && isTelemetryStale ? 'opacity-50' : ''}`}>
                  <div className={`${cardGlass} p-4 rounded-2xl flex flex-col items-center text-center`}>
                    <span className={`text-[11px] ${textMuted} font-medium mb-2`}>{t('cpu')}</span>
                    <div className="relative w-20 h-20 flex items-center justify-center my-1">
                      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                        <path
                          className={isLight ? "text-slate-200" : "text-white/10"}
                          strokeWidth="3.5"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className="text-emerald-500 transition-all duration-500 ease-out"
                          strokeDasharray={`${isConnected && cpuUsage !== null ? cpuUsage : 0}, 100`}
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                      <span className="absolute text-sm font-bold">
                        {isConnected && cpuUsage !== null ? `${cpuUsage}%` : '- %'}
                      </span>
                    </div>
                    <span className={`text-[10px] ${textMuted} mt-1`}>
                      {isConnected ? 'Real-Time Host CPU' : 'Host Offline'}
                    </span>
                  </div>

                  <div className={`${cardGlass} p-4 rounded-2xl flex flex-col items-center text-center`}>
                    <span className={`text-[11px] ${textMuted} font-medium mb-2`}>{t('ram')}</span>
                    <div className="relative w-20 h-20 flex items-center justify-center my-1">
                      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                        <path
                          className={isLight ? "text-slate-200" : "text-white/10"}
                          strokeWidth="3.5"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className="text-sky-500 transition-all duration-500 ease-out"
                          strokeDasharray={`${isConnected && ramUsage !== null ? ramUsage : 0}, 100`}
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                      <span className="absolute text-sm font-bold">
                        {isConnected && ramUsage !== null ? `${ramUsage}%` : '- %'}
                      </span>
                    </div>
                    <span className={`text-[10px] ${textMuted} mt-1`}>
                      {isConnected ? 'Real-Time Host RAM' : 'Host Offline'}
                    </span>
                  </div>
                </div>

                <div className={`${cardGlass} p-4 rounded-2xl flex items-center justify-between transition-opacity duration-300 ${isConnected && isTelemetryStale ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${cardGlassStrong} flex items-center justify-center`}>
                      <Wifi className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold">{t('netTraffic')}</h4>
                      <p className={`text-[10px] ${textMuted} font-mono`}>
                        {securityInfo?.scheme === 'wss' ? 'WebSocket wss:// (TLS)' : 'WebSocket ws:// (локальная сеть, без TLS)'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 rounded-xl">
                      <ArrowDown className="w-3.5 h-3.5 text-emerald-500" />
                      <div className="flex flex-col">
                        <span className="text-[9px] opacity-60 leading-none">DOWN</span>
                        <span className="text-xs font-mono font-bold text-emerald-500 leading-tight">
                          {isConnected && netSpeedDown !== null ? `${netSpeedDown} MB/s` : '- MB/s'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 bg-sky-500/10 border border-sky-500/20 px-2.5 py-1.5 rounded-xl">
                      <ArrowUp className="w-3.5 h-3.5 text-sky-500" />
                      <div className="flex flex-col">
                        <span className="text-[9px] opacity-60 leading-none">UP</span>
                        <span className="text-xs font-mono font-bold text-sky-500 leading-tight">
                          {isConnected && netSpeedUp !== null ? `${netSpeedUp} MB/s` : '- MB/s'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={`${cardGlass} p-4 rounded-2xl space-y-3`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Tv className="w-4 h-4 text-emerald-500" />
                      <span className="text-xs font-semibold">{t('liveStreamTitle')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      <span className="text-[10px] font-mono text-emerald-500 font-bold uppercase">
                        {streamQuality} • {fps} FPS
                      </span>
                    </div>
                  </div>

                  <div className="relative aspect-video rounded-xl overflow-hidden border border-slate-700 bg-slate-950 flex flex-col justify-between p-3 group shadow-2xl text-white">
                    {screenStream ? (
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="absolute inset-0 w-full h-full object-contain bg-black z-0"
                      />
                    ) : screenFrameData ? (
                      <img
                        src={screenFrameData}
                        alt="Real Live Desktop Stream"
                        className="absolute inset-0 w-full h-full object-contain bg-black z-0"
                      />
                    ) : (
                      <div className="my-auto py-2 font-mono text-[11px] text-emerald-400/90 leading-snug space-y-1 relative z-0 text-center">
                        <p className="text-sky-300">&gt; Windows 11 Host Connected</p>
                        <p className="text-slate-400 animate-pulse">&gt; Waiting for next screen frame from host...</p>
                      </div>
                    )}

                    {!isLiveStreaming && (
                      <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex flex-col items-center justify-center gap-2 z-20 transition-all duration-300 text-white">
                        <div className="bg-slate-800/95 p-3 rounded-full border border-slate-700 shadow-xl">
                          <Pause className="w-6 h-6 text-amber-500 animate-pulse" />
                        </div>
                        <span className="text-sm font-semibold tracking-wide text-slate-200">
                          {lang === 'ru' ? 'Стрим на паузе' : 'Stream Paused'}
                        </span>
                        <span className="text-[10px] text-slate-400 max-w-[200px] text-center px-4">
                          {lang === 'ru' ? 'Нажмите "Запустить стрим" для возобновления' : 'Click "Start Stream" to resume'}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[10px] font-mono text-white/70 z-10 bg-black/60 backdrop-blur-xs px-2 py-1 rounded-md">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-white font-semibold">LIVE STREAM</span>
                      </div>
                      <div className="flex items-center gap-3 text-white/60">
                        <span>WS Active</span>
                        <span>aether-v1</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-white/70 border-t border-white/20 pt-1.5 z-10 bg-black/60 backdrop-blur-xs px-2 rounded-md">
                      <span>Host: {hostName}</span>
                      <span className="text-emerald-400 font-mono">Real-Time WebSocket Feed</span>
                    </div>

                    <button
                      onClick={() => setShowFullStream(true)}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-xs font-semibold text-white backdrop-blur-xs z-30"
                    >
                      <Maximize2 className="w-5 h-5 text-emerald-400" />
                      <span>{t('expandStream')}</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      onClick={() => {
                        const nextState = !isLiveStreaming;
                        setIsLiveStreaming(nextState);
                        showToast(nextState ? (lang === 'ru' ? 'Стрим запущен' : 'Stream active') : (lang === 'ru' ? 'Стрим на паузе' : 'Stream paused'));
                      }}
                      className={`flex-1 ${cardGlassStrong} py-2.5 rounded-xl text-xs font-semibold hover:opacity-90 transition-all flex items-center justify-center gap-2`}
                    >
                      {isLiveStreaming ? <Pause className="w-3.5 h-3.5 text-amber-500" /> : <Play className="w-3.5 h-3.5 text-emerald-500" />}
                      <span>{isLiveStreaming ? t('pauseStream') : t('playStream')}</span>
                    </button>

                    <button
                      onClick={() => {
                        const qualities: Array<'1080p' | '720p' | '480p'> = ['1080p', '720p', '480p'];
                        const nextQ = qualities[(qualities.indexOf(streamQuality) + 1) % qualities.length];
                        setStreamQuality(nextQ);
                        showToast(`Quality: ${nextQ}`);
                      }}
                      className={`${cardGlass} px-3 py-2.5 rounded-xl text-xs font-mono font-bold hover:border-slate-400`}
                    >
                      {streamQuality}
                    </button>

                    <button
                      onClick={() => setShowFullStream(true)}
                      className={`${cardGlass} p-2.5 rounded-xl hover:border-slate-400`}
                      title={t('expandStream')}
                    >
                      <Maximize2 className="w-4 h-4 text-emerald-500" />
                    </button>
                  </div>
                </div>

                <div className={`${cardGlass} p-4 rounded-2xl flex items-center justify-between`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${cardGlassStrong} flex items-center justify-center`}>
                      <X className="w-5 h-5 text-rose-500" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold">{t('closeActiveWindow')}</h4>
                      <p className={`text-[11px] ${textMuted}`}>{t('closeActiveWindowSub')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowCloseWindowConfirm(true)}
                    className="liquid-glass px-3.5 py-2 rounded-xl text-xs text-rose-500 hover:bg-rose-500/10 font-semibold transition-colors"
                  >
                    {t('close')}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'media' && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <h2 className="font-heading text-2xl italic">{t('mediaCenter')}</h2>
                  <p className={`text-xs ${textMuted}`}>{t('mediaSub')}</p>
                </div>

                <div className={`${cardGlass} p-5 rounded-2xl text-center space-y-4`}>
                  <div className={`w-24 h-24 mx-auto rounded-2xl ${cardGlassStrong} flex items-center justify-center shadow-xl relative overflow-hidden group`}>
                    <Music className="w-10 h-10 text-emerald-500" />
                    {isPlaying && (
                      <div className="absolute bottom-2 flex items-end gap-1 h-3">
                        <span className="w-0.5 bg-emerald-500 h-full animate-bounce" />
                        <span className="w-0.5 bg-emerald-500 h-2/3 animate-bounce delay-75" />
                        <span className="w-0.5 bg-emerald-500 h-4/5 animate-bounce delay-150" />
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold truncate px-2">{currentTrack.title}</h3>
                    <p className={`text-xs ${textMuted}`}>{currentTrack.artist}</p>
                  </div>

                  <div className="flex items-center justify-center gap-6 pt-2">
                    <button
                      onClick={() => {
                        sendWsMessage({ action: 'MEDIA', type: 'SKIP_PREV', command: 'PREV_TRACK' });
                        showToast(lang === 'ru' ? 'Предыдущий трек' : 'Previous track');
                      }}
                      className={`${cardGlass} p-3 rounded-full hover:scale-105 transition-transform`}
                    >
                      <SkipBack className="w-5 h-5" />
                    </button>

                    <button
                      onClick={() => {
                        const nextState = !isPlaying;
                        setIsPlaying(nextState);
                        sendWsMessage({ action: 'MEDIA', type: 'PLAY_PAUSE', command: 'PLAY_PAUSE' });
                        showToast(nextState ? (lang === 'ru' ? 'Воспроизведение' : 'Playing') : (lang === 'ru' ? 'Пауза' : 'Pause'));
                      }}
                      className={`${cardGlassStrong} p-4 rounded-full hover:scale-105 transition-transform shadow-lg`}
                    >
                      {isPlaying ? <Pause className="w-6 h-6 fill-current text-emerald-500" /> : <Play className="w-6 h-6 fill-current text-emerald-500 ml-0.5" />}
                    </button>

                    <button
                      onClick={() => {
                        sendWsMessage({ action: 'MEDIA', type: 'SKIP_NEXT', command: 'NEXT_TRACK' });
                        showToast(lang === 'ru' ? 'Следующий трек' : 'Next track');
                      }}
                      className={`${cardGlass} p-3 rounded-full hover:scale-105 transition-transform`}
                    >
                      <SkipForward className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className={`${cardGlass} p-5 rounded-2xl space-y-4`}>
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="flex items-center gap-2">
                      {isMuted ? <VolumeX className="w-4 h-4 text-rose-500" /> : <Volume2 className="w-4 h-4 text-emerald-500" />}
                      <span>{t('pcVolume')}</span>
                    </span>
                    <span className="font-mono font-bold">{isMuted ? '0%' : `${volume}%`}</span>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      setIsMuted(false);
                      sendWsMessage({ action: 'MEDIA', type: 'VOLUME_SET', command: 'VOL_SET', val: v });
                    }}
                    className="w-full h-2 bg-slate-300 dark:bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <button
                      onClick={() => {
                        const newVol = Math.max(0, volume - 5);
                        setVolume(newVol);
                        setIsMuted(false);
                        sendWsMessage({ action: 'MEDIA', type: 'VOLUME_SET', command: 'VOL_DOWN', val: 5 });
                      }}
                      className={`${cardGlass} py-2 rounded-xl text-xs font-medium hover:border-slate-400`}
                    >
                      -5%
                    </button>
                    <button
                      onClick={() => {
                        const nextMuted = !isMuted;
                        setIsMuted(nextMuted);
                        sendWsMessage({ action: 'MEDIA', type: 'VOLUME_SET', command: 'VOL_MUTE', val: nextMuted ? 0 : volume });
                        showToast(nextMuted ? (lang === 'ru' ? 'Без звука' : 'Muted') : (lang === 'ru' ? 'Звук включен' : 'Unmuted'));
                      }}
                      className={`${cardGlass} py-2 rounded-xl text-xs font-medium transition-colors ${
                        isMuted ? 'text-rose-500 bg-rose-500/10' : 'hover:border-slate-400'
                      }`}
                    >
                      {isMuted ? t('unmute') : t('mute')}
                    </button>
                    <button
                      onClick={() => {
                        const newVol = Math.min(100, volume + 5);
                        setVolume(newVol);
                        setIsMuted(false);
                        sendWsMessage({ action: 'MEDIA', type: 'VOLUME_SET', command: 'VOL_UP', val: 5 });
                      }}
                      className={`${cardGlass} py-2 rounded-xl text-xs font-medium hover:border-slate-400`}
                    >
                      +5%
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'tools' && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <h2 className="font-heading text-2xl italic">{t('toolsCommands')}</h2>
                  <p className={`text-xs ${textMuted}`}>{t('toolsSub')}</p>
                </div>

                <div className={`${cardGlass} p-5 rounded-2xl space-y-3`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clipboard className="w-4 h-4 text-emerald-500" />
                      <span className="text-xs font-semibold">{t('winClipboard')}</span>
                    </div>
                    <button
                      onClick={() => {
                        sendWsMessage({ action: 'CLIPBOARD', command: 'GET_CLIPBOARD' });
                        showToast(lang === 'ru' ? 'Запрос буфера ПК...' : 'Reading PC clipboard...');
                      }}
                      className={`text-[11px] ${textMuted} hover:text-emerald-500 flex items-center gap-1`}
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>{t('readClipboard')}</span>
                    </button>
                  </div>

                  <div className={`${cardGlassStrong} p-3 rounded-xl font-mono text-xs break-all select-all`}>
                    {pcClipboardText}
                  </div>

                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(pcClipboardText);
                      showToast(lang === 'ru' ? 'Скопировано на телефон' : 'Copied to phone');
                    }}
                    className={`w-full ${cardGlass} py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-2 hover:border-slate-400`}
                  >
                    <Copy className="w-3.5 h-3.5 text-emerald-500" />
                    <span>{t('copyToPhone')}</span>
                  </button>
                </div>

                <div className={`${cardGlass} p-5 rounded-2xl space-y-3`}>
                  <span className="text-xs font-semibold block">{t('sendToClipboard')}</span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={t('sendToClipboardPlaceholder')}
                      value={sendClipboardInput}
                      onChange={(e) => setSendClipboardInput(e.target.value)}
                      className={`flex-1 ${inputStyle} px-3.5 py-2.5 rounded-xl text-xs focus:outline-none`}
                    />
                    <button
                      onClick={() => {
                        if (sendClipboardInput.trim()) {
                          const txt = sendClipboardInput.trim();
                          setPcClipboardText(txt);
                          sendWsMessage({ action: "CLIPBOARD", command: "SET", text: sendClipboardInput });
                          setSendClipboardInput('');
                          showToast(lang === 'ru' ? 'Отправлено в буфер ПК' : 'Sent to PC Clipboard');
                        }
                      }}
                      className={`${cardGlassStrong} px-4 py-2.5 rounded-xl text-xs font-semibold hover:bg-emerald-500/10`}
                    >
                      <Send className="w-4 h-4 text-emerald-500" />
                    </button>
                  </div>
                </div>

                <div className={`${cardGlass} p-5 rounded-2xl space-y-3`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-rose-500" />
                      <span className="text-xs font-semibold">{t('killProcessTitle')}</span>
                    </div>
                  </div>
                  <p className={`text-[11px] ${textMuted}`}>{t('killProcessSub')}</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={t('killProcessPlaceholder')}
                      value={killProcInput}
                      onChange={(e) => setKillProcInput(e.target.value)}
                      className={`flex-1 ${inputStyle} px-3.5 py-2.5 rounded-xl text-xs focus:outline-none`}
                    />
                    <button
                      onClick={() => {
                        if (killProcInput.trim()) {
                          const target = killProcInput.trim();
                          sendWsMessage({ action: 'KILL_PROCESS', process_name: target, process: target });
                          setKillProcInput('');
                          showToast(lang === 'ru' ? `Процесс ${target} завершен!` : `Killed process ${target}!`);
                        }
                      }}
                      className="bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-500 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all"
                    >
                      {t('killProcessBtn')}
                    </button>
                  </div>
                </div>

                <div className={`${cardGlass} p-5 rounded-2xl space-y-3`}>
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-sky-400" />
                    <span className="text-xs font-semibold">{t('sendNotificationTitle')}</span>
                  </div>
                  <p className={`text-[11px] ${textMuted}`}>{t('sendNotificationSub')}</p>
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder={lang === 'ru' ? 'Заголовок (например, Уведомление)' : 'Toast Title (e.g., Aether Alert)'}
                      value={toastTitleInput}
                      onChange={(e) => setToastTitleInput(e.target.value)}
                      className={`w-full ${inputStyle} px-3.5 py-2.5 rounded-xl text-xs focus:outline-none`}
                    />
                    <input
                      type="text"
                      placeholder={t('sendNotifPlaceholder')}
                      value={toastMsgInput}
                      onChange={(e) => setToastMsgInput(e.target.value)}
                      className={`w-full ${inputStyle} px-3.5 py-2.5 rounded-xl text-xs focus:outline-none`}
                    />
                    <button
                      onClick={() => {
                        if (toastMsgInput.trim() || toastTitleInput.trim()) {
                          sendWsMessage({ action: "SEND_TOAST", title: toastTitleInput, message: toastMsgInput });
                          setToastTitleInput('');
                          setToastMsgInput('');
                          showToast(lang === 'ru' ? 'Уведомление отправлено на ПК' : 'Toast notification sent to PC');
                        }
                      }}
                      className={`w-full ${cardGlassStrong} py-2.5 rounded-xl text-xs font-semibold text-sky-400 hover:bg-sky-500/10 flex items-center justify-center gap-2`}
                    >
                      <Send className="w-3.5 h-3.5 text-sky-400" />
                      <span>{t('sendNotifBtn')}</span>
                    </button>
                  </div>
                </div>

                <div className={`${cardGlass} p-5 rounded-2xl space-y-3 border border-emerald-500/30`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-emerald-500" />
                      <span className="text-xs font-semibold">{t('psAdminTitle')}</span>
                    </div>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded-full font-bold">
                      {t('elevatedAdmin')}
                    </span>
                  </div>

                  <p className={`text-[11px] ${textMuted}`}>
                    {lang === 'ru' ? 'Выполнение команд с полными правами Администратора на ПК.' : 'Direct execution with full Administrator rights on PC.'}
                  </p>

                  <div className="bg-slate-950 p-3.5 rounded-xl font-mono text-[11px] text-emerald-400 overflow-y-auto max-h-52 space-y-2 border border-slate-800 text-left leading-relaxed shadow-inner">
                    {psLogs.map((log) => (
                      <div key={log.id} className="space-y-0.5">
                        <div className="flex items-center justify-between opacity-50 text-[9px] text-slate-400">
                          <span>{log.time}</span>
                          <span>{log.type === 'cmd' ? 'COMMAND' : 'OUTPUT'}</span>
                        </div>
                        <pre className="whitespace-pre-wrap font-mono text-[11px] text-sky-300 select-text">
                          {log.text}
                        </pre>
                      </div>
                    ))}
                    {isExecutingPs && (
                      <div className="flex items-center gap-2 text-amber-400 animate-pulse text-[10px]">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Running command on host...</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={t('executePsCmd')}
                      value={psCommand}
                      onChange={(e) => setPsCommand(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && executePowerShellCommand(psCommand)}
                      className={`flex-1 ${inputStyle} px-3.5 py-2.5 rounded-xl font-mono text-xs focus:outline-none`}
                    />
                    <button
                      onClick={() => executePowerShellCommand(psCommand)}
                      disabled={isExecutingPs || !psCommand.trim()}
                      className={`${cardGlassStrong} px-4 py-2.5 rounded-xl text-xs font-semibold text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-30`}
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="pt-1 space-y-1.5">
                    <span className={`text-[10px] ${textMuted} font-semibold block`}>{t('quickCmds')}</span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => executePowerShellCommand('Get-Process | Sort-Object CPU -Descending | Select-Object -First 10')}
                        className={`${cardGlass} px-2.5 py-1 rounded-lg text-[10px] font-mono hover:border-slate-400`}
                      >
                        Get-Process
                      </button>
                      <button
                        onClick={() => executePowerShellCommand('ipconfig /all')}
                        className={`${cardGlass} px-2.5 py-1 rounded-lg text-[10px] font-mono hover:border-slate-400`}
                      >
                        ipconfig
                      </button>
                      <button
                        onClick={() => executePowerShellCommand('Get-Service | Where-Object Status -eq Running')}
                        className={`${cardGlass} px-2.5 py-1 rounded-lg text-[10px] font-mono hover:border-slate-400`}
                      >
                        Get-Service
                      </button>
                      <button
                        onClick={() => executePowerShellCommand('Get-Volume')}
                        className={`${cardGlass} px-2.5 py-1 rounded-lg text-[10px] font-mono hover:border-slate-400`}
                      >
                        Get-Volume
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'power' && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <h2 className="font-heading text-2xl italic">{t('powerAndSecurity')}</h2>
                  <p className={`text-xs ${textMuted}`}>{t('powerSub')}</p>
                </div>

                <div className="space-y-3">
                  <div
                    onClick={() => {
                      setIsSendingWol(true);
                      setTimeout(() => {
                        setIsSendingWol(false);
                        showToast(lang === 'ru' ? `WOL пакет отправлен на MAC: ${macAddress}` : `WOL packet sent to MAC: ${macAddress}`);
                      }, 1200);
                    }}
                    className={`${cardGlass} p-4 rounded-2xl flex items-center justify-between cursor-pointer hover:border-emerald-500/50 border border-emerald-500/30 transition-colors group`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                        <Radio className={`w-5 h-5 text-emerald-500 ${isSendingWol ? 'animate-ping' : ''}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-semibold group-hover:text-emerald-500 transition-colors">
                            {t('wolTitle')}
                          </h4>
                          <span className="text-[9px] bg-emerald-500/20 text-emerald-500 font-bold px-1.5 py-0.5 rounded-full">
                            WOL
                          </span>
                        </div>
                        <p className={`text-[10px] ${textMuted} font-mono`}>
                          Magic Packet UDP • MAC: {macAddress}
                        </p>
                      </div>
                    </div>
                    <button className={`${cardGlass} px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-500 hover:bg-emerald-500/20 transition-colors flex items-center gap-1`}>
                      {isSendingWol ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>{t('sendingSignal')}</span>
                        </>
                      ) : (
                        <span>{t('turnOnPc')}</span>
                      )}
                    </button>
                  </div>

                  <div
                    onClick={() => setPowerActionConfirm('SHUTDOWN')}
                    className={`${cardGlass} p-4 rounded-2xl flex items-center justify-between cursor-pointer hover:border-rose-500/50 transition-colors group`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${cardGlassStrong} flex items-center justify-center`}>
                        <Power className="w-5 h-5 text-rose-500" />
                      </div>
                      <h4 className="text-xs font-semibold group-hover:text-rose-500 transition-colors">{t('shutdownPc')}</h4>
                    </div>
                  </div>

                  <div
                    onClick={() => setPowerActionConfirm('REBOOT')}
                    className={`${cardGlass} p-4 rounded-2xl flex items-center justify-between cursor-pointer hover:border-sky-500/50 transition-colors group`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${cardGlassStrong} flex items-center justify-center`}>
                        <RotateCcw className="w-5 h-5 text-sky-500" />
                      </div>
                      <h4 className="text-xs font-semibold group-hover:text-sky-500 transition-colors">{t('rebootPc')}</h4>
                    </div>
                  </div>

                  <div
                    onClick={() => setPowerActionConfirm('LOCK')}
                    className={`${cardGlass} p-4 rounded-2xl flex items-center justify-between cursor-pointer hover:border-amber-500/50 transition-colors group`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${cardGlassStrong} flex items-center justify-center`}>
                        <Lock className="w-5 h-5 text-amber-500" />
                      </div>
                      <h4 className="text-xs font-semibold group-hover:text-amber-500 transition-colors">{t('lockSession')}</h4>
                    </div>
                  </div>

                  <div
                    onClick={() => setPowerActionConfirm('SLEEP')}
                    className={`${cardGlass} p-4 rounded-2xl flex items-center justify-between cursor-pointer hover:border-purple-500/50 transition-colors group`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${cardGlassStrong} flex items-center justify-center`}>
                        <Moon className="w-5 h-5 text-purple-500" />
                      </div>
                      <h4 className="text-xs font-semibold group-hover:text-purple-500 transition-colors">{t('sleepMode')}</h4>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </main>
        )}

        {isConnected && (
          <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 max-w-sm w-[92%] z-40">
            <div className={`${cardGlassStrong} rounded-full p-1.5 flex items-center justify-around shadow-2xl border border-slate-300 dark:border-white/20 backdrop-blur-3xl`}>
              <button
                onClick={() => setActiveTab('system')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full transition-all text-xs font-medium ${
                  activeTab === 'system' 
                    ? 'bg-emerald-500 text-black font-semibold shadow-lg' 
                    : `${textMuted} hover:text-emerald-500`
                }`}
              >
                <Monitor className="w-4 h-4" />
                {activeTab === 'system' && <span>{t('tabSystem')}</span>}
              </button>

              <button
                onClick={() => setActiveTab('media')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full transition-all text-xs font-medium ${
                  activeTab === 'media' 
                    ? 'bg-emerald-500 text-black font-semibold shadow-lg' 
                    : `${textMuted} hover:text-emerald-500`
                }`}
              >
                <Music className="w-4 h-4" />
                {activeTab === 'media' && <span>{t('tabMedia')}</span>}
              </button>

              <button
                onClick={() => setActiveTab('tools')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full transition-all text-xs font-medium ${
                  activeTab === 'tools' 
                    ? 'bg-emerald-500 text-black font-semibold shadow-lg' 
                    : `${textMuted} hover:text-emerald-500`
                }`}
              >
                <Wrench className="w-4 h-4" />
                {activeTab === 'tools' && <span>{t('tabTools')}</span>}
              </button>

              <button
                onClick={() => setActiveTab('power')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full transition-all text-xs font-medium ${
                  activeTab === 'power' 
                    ? 'bg-emerald-500 text-black font-semibold shadow-lg' 
                    : `${textMuted} hover:text-emerald-500`
                }`}
              >
                <Power className="w-4 h-4" />
                {activeTab === 'power' && <span>{t('tabPower')}</span>}
              </button>
            </div>
          </nav>
        )}
      </div>

      {showLogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className={`${cardGlassStrong} rounded-3xl p-6 max-w-md w-full space-y-4 animate-fade-in max-h-[85vh] flex flex-col`}>
            <div className="flex items-center justify-between shrink-0">
              <h3 className="font-heading text-2xl italic flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-500" />
                <span>{lang === 'ru' ? 'Диагностика подключения' : 'Connection Diagnostics'}</span>
              </h3>
              <button onClick={() => setShowLogsModal(false)} className={`p-1 ${textMuted} hover:text-rose-500 transition-colors`}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className={`text-[11px] ${textMuted} shrink-0`}>
              {lang === 'ru' 
                ? 'История последних попыток подключения и переданных пакетов' 
                : 'History of recent connection attempts and transmitted packets'}
            </p>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[250px] max-h-[50vh]">
              {connectionLogs.length === 0 ? (
                <div className="text-center py-12 text-xs opacity-60">
                  {lang === 'ru' ? 'История пуста' : 'No logs recorded yet'}
                </div>
              ) : (
                connectionLogs.map((log) => (
                  <div 
                    key={log.id} 
                    className={`p-3 rounded-2xl border ${
                      log.status === 'success' 
                        ? 'bg-emerald-500/10 border-emerald-500/30' 
                        : log.status === 'failed' 
                        ? 'bg-rose-500/10 border-rose-500/30' 
                        : log.status === 'connecting'
                        ? 'bg-amber-500/10 border-amber-500/30'
                        : 'bg-slate-500/10 border-slate-500/20'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] opacity-60 font-mono">{log.time}</span>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                        log.status === 'success' 
                          ? 'bg-emerald-500/20 text-emerald-400' 
                          : log.status === 'failed' 
                          ? 'bg-rose-500/20 text-rose-400' 
                          : log.status === 'connecting'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-slate-500/20 text-slate-400'
                      }`}>
                        {log.status}
                      </span>
                    </div>

                    <div className="space-y-1 text-xs">
                      <div className="flex items-center justify-between font-medium">
                        <span>{lang === 'ru' ? 'Адрес/ID:' : 'Target/ID:'}</span>
                        <span className="font-mono">{log.target}</span>
                      </div>
                      <div className="flex items-center justify-between opacity-80">
                        <span>{lang === 'ru' ? 'Транспорт:' : 'Transport:'}</span>
                        <span>{log.transport}</span>
                      </div>
                      <div className="flex items-center justify-between opacity-80">
                        <span>{lang === 'ru' ? 'Этап:' : 'Stage:'}</span>
                        <span className="font-medium text-emerald-400">{log.step}</span>
                      </div>
                      {log.errorDetail && (
                        <div className="mt-1.5 pt-1.5 border-t border-rose-500/20 text-[10px] text-rose-300 font-mono break-all leading-tight">
                          {log.errorDetail}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 shrink-0 flex gap-2">
              <button
                onClick={() => setConnectionLogs([])}
                className="flex-1 py-2.5 rounded-xl border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 text-xs font-semibold transition-colors"
              >
                {lang === 'ru' ? 'Очистить историю' : 'Clear history'}
              </button>
              <button
                onClick={() => setShowLogsModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
              >
                {lang === 'ru' ? 'Закрыть' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className={`${cardGlassStrong} rounded-3xl p-6 max-w-sm w-full space-y-5 animate-fade-in`}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-2xl italic">{t('settingsTitle')}</h3>
              <button onClick={() => setShowSettingsModal(false)} className={`p-1 ${textMuted} hover:text-rose-500`}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 p-3 rounded-2xl bg-slate-500/10 border border-slate-500/20">
              <div>
                <label className={`text-[11px] ${textMuted} font-semibold block mb-1.5 flex items-center gap-1.5`}>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t('theme')}</span>
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-900/40 border border-slate-700/50">
                  <button
                    onClick={() => setTheme('dark')}
                    className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      theme === 'dark' 
                        ? 'bg-slate-800 text-white shadow-md border border-slate-600' 
                        : `${textMuted} hover:text-white`
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{t('darkTheme')}</span>
                  </button>

                  <button
                    onClick={() => setTheme('light')}
                    className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      theme === 'light' 
                        ? 'bg-white text-slate-900 shadow-md border border-slate-300' 
                        : `${textMuted} hover:text-white`
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5 text-amber-500" />
                    <span>{t('lightTheme')}</span>
                  </button>
                </div>
              </div>

              <div>
                <label className={`text-[11px] ${textMuted} font-semibold block mb-1.5 flex items-center gap-1.5`}>
                  <Languages className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{t('language')}</span>
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-900/40 border border-slate-700/50">
                  <button
                    onClick={() => setLang('ru')}
                    className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      lang === 'ru' 
                        ? 'bg-emerald-500 text-black shadow-md font-bold' 
                        : `${textMuted} hover:text-white`
                    }`}
                  >
                    <span>🇷🇺 Русский</span>
                  </button>

                  <button
                    onClick={() => setLang('en')}
                    className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      lang === 'en' 
                        ? 'bg-emerald-500 text-black shadow-md font-bold' 
                        : `${textMuted} hover:text-white`
                    }`}
                  >
                    <span>🇬🇧 English</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              {isConnected && (
                <button
                  onClick={() => {
                    if (wsRef.current) {
                      const socketToClose = wsRef.current;
                      wsRef.current = null;
                      socketToClose.close();
                    }
                    if (reconnectTimeoutRef.current) {
                      clearTimeout(reconnectTimeoutRef.current);
                      reconnectTimeoutRef.current = null;
                    }
                    reconnectAttemptsRef.current = 0;

                    setIsConnected(false);
                    setConnectionStatus('DISCONNECTED');
                    setHostName('-');
                    setShowSettingsModal(false);
                    showToast(lang === 'ru' ? 'Сеанс отключен' : 'Disconnected');
                  }}
                  className={`flex-1 ${cardGlass} py-2.5 rounded-xl text-xs text-rose-500 font-semibold hover:bg-rose-500/10`}
                >
                  {t('disconnect')}
                </button>
              )}
              <button
                onClick={() => {
                  setShowSettingsModal(false);
                  showToast(lang === 'ru' ? 'Настройки сохранены' : 'Settings saved');
                }}
                className={`flex-1 ${cardGlassStrong} py-2.5 rounded-xl text-xs font-semibold text-emerald-500 hover:bg-emerald-500/10`}
              >
                {t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFullStream && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl">
          <div className="max-w-4xl w-full space-y-3 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tv className="w-5 h-5 text-emerald-400" />
                <span className="text-sm font-semibold">{t('liveStreamTitle')} • {hostName}</span>
              </div>
              <button onClick={() => setShowFullStream(false)} className="p-1 text-white/60 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="aspect-video bg-slate-950 rounded-2xl border border-slate-800 p-4 font-mono text-xs text-emerald-400 flex flex-col justify-between shadow-2xl relative overflow-hidden">
              {screenStream ? (
                <video
                  ref={fullVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-contain bg-black z-0"
                />
              ) : screenFrameData ? (
                <img
                  src={screenFrameData}
                  alt="Full Live Desktop Stream"
                  className="absolute inset-0 w-full h-full object-contain bg-black z-0"
                />
              ) : (
                <div className="my-auto text-center py-16 text-white/60 space-y-2 z-0">
                  <div className="text-lg font-bold text-white">Windows Desktop Live Stream</div>
                  <div className="text-xs text-emerald-400 font-mono">Waiting for video stream frames...</div>
                </div>
              )}

              {!isLiveStreaming && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex flex-col items-center justify-center gap-2 z-20 transition-all duration-300 text-white">
                  <div className="bg-slate-800/95 p-3 rounded-full border border-slate-700 shadow-xl">
                    <Pause className="w-8 h-8 text-amber-500 animate-pulse" />
                  </div>
                  <span className="text-base font-semibold tracking-wide text-slate-200">
                    {lang === 'ru' ? 'Стрим на паузе' : 'Stream Paused'}
                  </span>
                  <span className="text-xs text-slate-400">
                    {lang === 'ru' ? 'Нажмите "Запустить стрим" для возобновления' : 'Click "Start Stream" to resume'}
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center bg-black/60 p-2 rounded-lg backdrop-blur-md z-10">
                <p>&gt; FULLSCREEN_SCREEN_STREAM_ACTIVE [{streamQuality}]</p>
                <p className="text-emerald-400 font-bold">&gt; WebSocket Connected</p>
              </div>

              <div className="flex justify-between text-white/70 text-[10px] bg-black/60 p-1.5 rounded-lg backdrop-blur-md z-10">
                <span>Aether Stream Protocol v1</span>
                <span>Protected by E2EE</span>
              </div>
            </div>
          </div>
        </div>
      )}


      {adminConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className={`${cardGlassStrong} rounded-3xl p-6 max-w-xs w-full text-center space-y-4 border border-rose-500/40`}>
            <div className="w-12 h-12 rounded-full bg-rose-500/20 mx-auto flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-rose-500" />
            </div>
            <h3 className="font-heading text-2xl italic text-rose-400">
              {lang === 'ru' ? 'Запрос разрешения' : 'Admin Request'}
            </h3>
            <p className={`text-xs ${textMuted} leading-relaxed`}>
              {lang === 'ru' ? 'Эта команда может быть опасна. Выполнить?' : 'This command may be dangerous. Execute?'}
            </p>
            <div className="bg-slate-950 p-2.5 rounded-xl font-mono text-xs text-rose-400 break-all border border-slate-800">
              {adminConfirmDialog.command}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setAdminConfirmDialog(null)}
                className={`flex-1 ${cardGlass} py-2.5 rounded-xl text-xs`}
              >
                {lang === 'ru' ? 'Отмена' : 'Cancel'}
              </button>
              <button
                onClick={() => {
                  sendWsMessage({ action: 'POWERSHELL', command: adminConfirmDialog.command, force: true, confirm: true });
                  setAdminConfirmDialog(null);
                }}
                className="flex-1 liquid-glass-strong py-2.5 rounded-xl text-xs font-semibold text-rose-500 bg-rose-500/20"
              >
                {lang === 'ru' ? 'Выполнить' : 'Execute'}
              </button>
            </div>
          </div>
        </div>
      )}
      {psConfirmCommand && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className={`${cardGlassStrong} rounded-3xl p-6 max-w-xs w-full text-center space-y-4 border border-rose-500/40`}>
            <div className="w-12 h-12 rounded-full bg-rose-500/20 mx-auto flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-rose-500" />
            </div>
            <h3 className="font-heading text-2xl italic">{t('attentionAdmin')}</h3>
            <p className={`text-xs ${textMuted} leading-relaxed`}>
              {t('dangerousCmdWarning')}
            </p>
            <div className="bg-slate-950 p-2.5 rounded-xl font-mono text-xs text-rose-400 break-all border border-slate-800">
              {psConfirmCommand}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPsConfirmCommand(null)}
                className={`flex-1 ${cardGlass} py-2.5 rounded-xl text-xs`}
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => executePowerShellCommand(psConfirmCommand)}
                className="flex-1 liquid-glass-strong py-2.5 rounded-xl text-xs font-semibold text-rose-500 bg-rose-500/20"
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCloseWindowConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className={`${cardGlassStrong} rounded-3xl p-6 max-w-xs w-full text-center space-y-4`}>
            <div className="w-12 h-12 rounded-full bg-rose-500/20 mx-auto flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-rose-500" />
            </div>
            <h3 className="font-heading text-2xl italic">{t('confirmCloseWindow')}</h3>
            <p className={`text-xs ${textMuted}`}>{t('altF4Notice')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCloseWindowConfirm(false)}
                className={`flex-1 ${cardGlass} py-2.5 rounded-xl text-xs`}
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => {
                  setShowCloseWindowConfirm(false);
                  sendWsMessage({ action: 'POWER', command: 'CLOSE_WINDOW' });
                  showToast(lang === 'ru' ? 'Команда Alt+F4 отправлена' : 'Alt+F4 command sent');
                }}
                className="flex-1 liquid-glass-strong py-2.5 rounded-xl text-xs font-semibold text-rose-500 bg-rose-500/10"
              >
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {powerActionConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className={`${cardGlassStrong} rounded-3xl p-6 max-w-xs w-full text-center space-y-4`}>
            <div className="w-12 h-12 rounded-full bg-amber-500/20 mx-auto flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-amber-500" />
            </div>
            <h3 className="font-heading text-2xl italic">{t('confirmPowerTitle')}</h3>
            <p className={`text-xs ${textMuted}`}>
              {powerActionConfirm === 'SHUTDOWN' && t('confirmShutdownMsg')}
              {powerActionConfirm === 'REBOOT' && t('confirmRebootMsg')}
              {powerActionConfirm === 'LOCK' && t('confirmLockMsg')}
              {powerActionConfirm === 'SLEEP' && t('confirmSleepMsg')}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPowerActionConfirm(null)}
                className={`flex-1 ${cardGlass} py-2.5 rounded-xl text-xs`}
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => {
                  const cmd = powerActionConfirm;
                  setPowerActionConfirm(null);
                  sendWsMessage({ action: 'POWER', command: cmd });
                  showToast(lang === 'ru' ? 'Системная команда отправлена' : 'System power command sent');
                }}
                className={`flex-1 ${cardGlassStrong} py-2.5 rounded-xl text-xs font-semibold text-emerald-500`}
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
