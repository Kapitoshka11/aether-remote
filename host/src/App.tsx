import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { MainPairingCard } from './components/MainPairingCard';
import { SecurityAndStats } from './components/SecurityAndStats';
import { ScreenStreamView } from './components/ScreenStreamView';
import { FileExchangePanel } from './components/FileExchangePanel';
import { AuditLogConsole } from './components/AuditLogConsole';
import { SettingsModal } from './components/SettingsModal';
import { AuditLogEntry, ConnectionStatus, ConnectedDeviceInfo, SystemStats, RemoteCommand } from './types';
import { Language } from './data/translations';
import { generateSmartPin, encodeUniversal9Code } from './utils/hardwarePin';
import { AetherDeckEditor } from './aether-deck/AetherDeckEditor';
import { getDesktopBridge, isDesktopRuntime } from './platform/desktopBridge';
import { GradientBackground } from './components/ui/orange-gamification';

export default function App() {
  const [activeAppTab, setActiveAppTab] = useState<'main' | 'deck'>('main');
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [approvedTokens, setApprovedTokens] = useState<any[]>([]);

  const [ipAddress, setIpAddress] = useState('127.0.0.1');
  const [networkEndpoints, setNetworkEndpoints] = useState<Array<{ address: string; interfaceName: string }>>([]);
  const [pin, setPin] = useState<string>(() => generateSmartPin('127.0.0.1'));
  const hardwarePinRef = useRef<string>(pin);
  const [port] = useState(8080);
  const [tlsFingerprint, setTlsFingerprint] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('LISTENING_FOR_CLIENT');

  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('aether-language');
      if (saved === 'EN' || saved === 'RU') return saved;
    }
    return 'RU';
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('aether-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return 'dark';
  });
  const [autoStart, setAutoStart] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('aether-autostart');
      if (saved !== null) return saved === 'true';
    }
    return false;
  });
  const [minimizeToTray, setMinimizeToTray] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('aether-minimizetotray');
      if (saved !== null) return saved === 'true';
    }
    return true;
  });
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('aether-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('aether-language', language);
    }
  }, [language]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('aether-autostart', String(autoStart));
      getDesktopBridge()?.send('set-autostart', autoStart);
    }
  }, [autoStart]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('aether-minimizetotray', String(minimizeToTray));
      getDesktopBridge()?.send('set-minimize-to-tray', minimizeToTray);
    }
  }, [minimizeToTray]);

  useEffect(() => {
    if (typeof window !== 'undefined' && !isDesktopRuntime()) {
      const newPin = generateSmartPin(ipAddress);
      setPin(newPin);
      hardwarePinRef.current = newPin;
    }
  }, [ipAddress]);

  useEffect(() => {
    const ipcRenderer = getDesktopBridge();
    if (ipcRenderer) {
      try {
        ipcRenderer.invoke('get-system-info').then((info: any) => {
          if (info) {
            if (info.ipAddress) setIpAddress(info.ipAddress);
            if (Array.isArray(info.networkEndpoints)) setNetworkEndpoints(info.networkEndpoints);
            if (info.tlsFingerprint) setTlsFingerprint(info.tlsFingerprint);
            if (info.hardwarePin) {
              hardwarePinRef.current = info.hardwarePin;
              setPin(info.hardwarePin);
            }
            if (info.hostname) {
              setStats((prev) => ({
                ...prev,
                hostname: info.hostname,
                osVersion: info.osVersion || prev.osVersion,
              }));
            }
          }
        });

        ipcRenderer.on('hardware-info-updated', (_: any, data: any) => {
          if (data) {
            if (data.hardwarePin) {
              hardwarePinRef.current = data.hardwarePin;
              setPin(data.hardwarePin);
            }
            if (data.ipAddress) {
              setIpAddress(data.ipAddress);
            }
            if (Array.isArray(data.networkEndpoints)) setNetworkEndpoints(data.networkEndpoints);
            if (data.tlsFingerprint) setTlsFingerprint(data.tlsFingerprint);
          }
        });

        ipcRenderer.on('telemetry-update', (_: any, telemetryData: any) => {
          if (telemetryData) {
            setStats((prev) => ({
              ...prev,
              cpuUsage: typeof telemetryData.cpu === 'number' ? telemetryData.cpu : prev.cpuUsage,
              ramUsage: typeof telemetryData.ram === 'number' ? telemetryData.ram : prev.ramUsage,
              ramUsedGb: typeof telemetryData.ramUsedGb === 'number' ? telemetryData.ramUsedGb : prev.ramUsedGb,
              ramTotalGb: typeof telemetryData.ramTotalGb === 'number' ? telemetryData.ramTotalGb : prev.ramTotalGb,
              netUploadMb: typeof telemetryData.net_upload === 'number' ? telemetryData.net_upload : prev.netUploadMb,
              netDownloadMb: typeof telemetryData.net_download === 'number' ? telemetryData.net_download : prev.netDownloadMb,
              hostname: telemetryData.hostname || prev.hostname,
              uptimeSeconds: typeof telemetryData.uptime === 'number' ? telemetryData.uptime : prev.uptimeSeconds,
              track: telemetryData.track,
              artist: telemetryData.artist,
              isPlaying: telemetryData.isPlaying,
              isScreenStreaming: telemetryData.isScreenStreaming === true,
            }));
          }
        });

        const handlePairingRequest = (_: any, data: { requestId: string, ip: string, deviceModel: string, type?: string }) => {
          setPendingApprovals(prev => {
            if (prev.some(p => p.id === data.requestId)) return prev;
            return [...prev, {
              id: data.requestId,
              ip: data.ip,
              deviceModel: data.deviceModel,
              type: data.type || 'pairing',
              trusted: false,
              onResolve: (approved: boolean, trusted = false) => {
                ipcRenderer.send('pairing-response', { requestId: data.requestId, approved, trusted: approved && trusted });
                setPendingApprovals(current => current.filter(p => p.id !== data.requestId));
              }
            }];
          });
        };

        const handlePairingCancel = (_: any, data: { requestId: string }) => {
          setPendingApprovals(prev => prev.filter(p => p.id !== data.requestId));
        };

        const handleTokensUpdated = (_: any, tokens: any[]) => {
          if (tokens) setApprovedTokens(tokens);
        };

        ipcRenderer.on('pairing-request', handlePairingRequest);
        ipcRenderer.on('pairing-cancel', handlePairingCancel);
        ipcRenderer.on('tokens-updated', handleTokensUpdated);

        ipcRenderer.invoke('get-approved-tokens').then((tokens: any[]) => {
          if (tokens) setApprovedTokens(tokens);
        });

        return () => {
          ipcRenderer.removeListener('pairing-request', handlePairingRequest);
          ipcRenderer.removeListener('pairing-cancel', handlePairingCancel);
          ipcRenderer.removeListener('tokens-updated', handleTokensUpdated);
        };
      } catch (e) {
        console.log('Browser preview environment detected');
      }
    }
  }, []);

  useEffect(() => {
    const ipcRenderer = getDesktopBridge();
    if (!ipcRenderer) return;

    let mediaStream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let processorNode: ScriptProcessorNode | null = null;
    let silentGain: GainNode | null = null;
    const stopCapture = async () => {
      if (processorNode) processorNode.onaudioprocess = null;
      try { processorNode?.disconnect(); } catch (_) {}
      try { sourceNode?.disconnect(); } catch (_) {}
      try { silentGain?.disconnect(); } catch (_) {}
      mediaStream?.getTracks().forEach(track => track.stop());
      if (audioContext && audioContext.state !== 'closed') await audioContext.close();
      mediaStream = null;
      audioContext = null;
      sourceNode = null;
      processorNode = null;
      silentGain = null;
    };

    const startCapture = async () => {
      if (mediaStream) return;
      try {
        mediaStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        mediaStream.getVideoTracks().forEach(track => track.stop());
        if (mediaStream.getAudioTracks().length === 0) throw new Error('Windows loopback audio is unavailable');

        audioContext = new AudioContext({ sampleRate: 44100 });
        sourceNode = audioContext.createMediaStreamSource(mediaStream);
        processorNode = audioContext.createScriptProcessor(4096, 2, 2);
        silentGain = audioContext.createGain();
        silentGain.gain.value = 0;

        processorNode.onaudioprocess = event => {
          const left = event.inputBuffer.getChannelData(0);
          const right = event.inputBuffer.numberOfChannels > 1 ? event.inputBuffer.getChannelData(1) : left;
          const pcm = new Int16Array(left.length * 2);
          for (let i = 0; i < left.length; i++) {
            pcm[i * 2] = Math.round(Math.max(-1, Math.min(1, left[i])) * 32767);
            pcm[i * 2 + 1] = Math.round(Math.max(-1, Math.min(1, right[i])) * 32767);
          }
          ipcRenderer.send('audio-pcm-chunk', { data: new Uint8Array(pcm.buffer) });
        };

        sourceNode.connect(processorNode);
        processorNode.connect(silentGain);
        silentGain.connect(audioContext.destination);
        ipcRenderer.send('audio-capture-status', { enabled: true });
      } catch (error: any) {
        await stopCapture();
        ipcRenderer.send('audio-capture-status', { enabled: false, error: error?.message || 'Audio capture failed' });
      }
    };

    const handleAudioToggle = (_event: unknown, payload: { enabled?: boolean }) => {
      if (payload?.enabled) void startCapture();
      else void stopCapture();
    };

    ipcRenderer.on('audio-capture-toggle', handleAudioToggle);
    return () => {
      ipcRenderer.removeListener('audio-capture-toggle', handleAudioToggle);
      void stopCapture();
    };
  }, []);

  const [failedAttempts, setFailedAttempts] = useState(0);
  const [blockedCooldownSec, setBlockedCooldownSec] = useState(0);
  const [isBlocked, setIsBlocked] = useState(false);

  const [connectedDevice, setConnectedDevice] = useState<ConnectedDeviceInfo | null>(null);

  const [stats, setStats] = useState<SystemStats>({
    cpuUsage: 0,
    ramUsage: 0,
    ramUsedGb: 0,
    ramTotalGb: 0,
    netUploadMb: 0,
    netDownloadMb: 0,
    hostname: '',
    osVersion: '',
    uptimeSeconds: 0,
  });

  const [isTrayMinimized, setIsTrayMinimized] = useState(false);

  const [logs, setLogs] = useState<AuditLogEntry[]>([
    {
      id: '1',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type: 'SYSTEM',
      message: 'Aether Remote запущен и готов к подключению',
      status: 'success',
    },
  ]);

  const addLog = (
    type: AuditLogEntry['type'],
    message: string,
    logStatus: AuditLogEntry['status'],
    clientIp?: string
  ) => {
    const entry: AuditLogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type,
      message,
      status: logStatus,
      clientIp,
    };
    setLogs((prev) => [...prev, entry]);
  };

  const handleWebSocketMessage = (cmd: RemoteCommand) => {
    const clientIp = '192.168.1.104';

    if (isBlocked) {
      addLog('AUTH_BLOCKED', `Blocked attempt from ${clientIp}. Cooldown active.`, 'error', clientIp);
      return;
    }

    if (cmd.action === 'AUTH') {
      if (cmd.sessionToken && !cmd.pin) {
        setStatus('CLIENT_CONNECTED');
        setFailedAttempts(0);
        setConnectedDevice({
          deviceModel: 'iPhone 15 Pro (Aether Mobile)',
          ipAddress: clientIp,
          connectedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          uptimeSeconds: 0,
        });
        addLog('AUTH_OK', `Client re-authenticated successfully from ${clientIp} via Session Token`, 'success', clientIp);
        return;
      }

      const cleanInputPin = (cmd.pin || '').replace(/\s|-/g, '');
      const pairingCodePayload = encodeUniversal9Code(ipAddress, pin);
      const isMatch = (
        cleanInputPin === pin ||
        cleanInputPin === hardwarePinRef.current ||
        cleanInputPin === pairingCodePayload.code9
      );
      if (isMatch) {
        setStatus('CLIENT_CONNECTED');
        setFailedAttempts(0);
        setConnectedDevice({
          deviceModel: 'iPhone 15 Pro (Aether Mobile)',
          ipAddress: clientIp,
          connectedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          uptimeSeconds: 0,
        });
        addLog('AUTH_OK', `Client authenticated successfully from ${clientIp} (Pairing Code Matched)`, 'success', clientIp);
      } else {
        const newFails = failedAttempts + 1;
        setFailedAttempts(newFails);
        if (newFails >= 3) {
          setIsBlocked(true);
          setStatus('BLOCKED_BRUTE_FORCE');
          setBlockedCooldownSec(60);
          addLog('AUTH_BLOCKED', `IP ${clientIp} blocked for 60s due to 3 failed PIN attempts`, 'error', clientIp);
        } else {
          addLog('AUTH_FAILED', `Invalid PIN attempt from ${clientIp} (${newFails}/3)`, 'warning', clientIp);
        }
      }
      return;
    }

    if (cmd.action === 'PING') {
      addLog('SYSTEM', 'Heartbeat PING received -> PONG sent', 'info', clientIp);
    } else if (cmd.action === 'GET_TELEMETRY' || (cmd as any).action === 'TELEMETRY') {
      const data = (cmd as any).data;
      if (data) {
        setStats((prev) => ({
          ...prev,
          cpuUsage: typeof data.cpu === 'number' ? data.cpu : prev.cpuUsage,
          ramUsage: typeof data.ram === 'number' ? data.ram : prev.ramUsage,
          ramUsedGb: typeof data.ramUsedGb === 'number' ? data.ramUsedGb : prev.ramUsedGb,
          ramTotalGb: typeof data.ramTotalGb === 'number' ? data.ramTotalGb : prev.ramTotalGb,
          netUploadMb: typeof data.net_upload === 'number' ? data.net_upload : prev.netUploadMb,
          netDownloadMb: typeof data.net_download === 'number' ? data.net_download : prev.netDownloadMb,
          hostname: data.hostname || prev.hostname,
          track: data.track,
          artist: data.artist,
          isPlaying: data.isPlaying,
          isScreenStreaming: data.isScreenStreaming === true,
        }));
      }
      addLog('SYSTEM_INFO', 'Telemetry requested (CPU, RAM, Net Speed)', 'info', clientIp);
    } else if (cmd.action === 'KILL_PROCESS') {
      addLog('SYSTEM', `Task Killer terminated process: ${cmd.command}`, 'warning', clientIp);
    } else if (cmd.action === 'SEND_TOAST') {
      addLog('SYSTEM', `Windows Toast Notification triggered`, 'info', clientIp);
    } else if (cmd.action === 'SWITCH_AUDIO_DEVICE') {
      addLog('SYSTEM', `Switched audio device: ${cmd.command}`, 'info', clientIp);
    } else if (cmd.action === 'TAKE_SCREENSHOT') {
      addLog('SCREEN_STREAM', `Instant full-res screenshot captured`, 'success', clientIp);
    } else if (cmd.action === 'POWER') {
      addLog('POWER', `EXEC POWER COMMAND: ${cmd.command}`, 'warning', clientIp);
    } else if (cmd.action === 'MEDIA') {
      addLog('MEDIA', `TRIGGER VIRTUAL MEDIA KEY: ${cmd.command}`, 'info', clientIp);
    } else if (cmd.action === 'SYSTEM') {
      if (cmd.command === 'WRITE_CLIPBOARD') {
        addLog('SYSTEM', `Copied text to Windows Clipboard`, 'info', clientIp);
      }
    }
  };

  useEffect(() => {
    if (!isBlocked || blockedCooldownSec <= 0) return;
    const interval = setInterval(() => {
      setBlockedCooldownSec((prev) => {
        if (prev <= 1) {
          setIsBlocked(false);
          setFailedAttempts(0);
          setStatus(connectedDevice ? 'CLIENT_CONNECTED' : 'LISTENING_FOR_CLIENT');
          addLog('SYSTEM', 'Anti-brute force cooldown expired. IP unblocked.', 'info');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isBlocked, blockedCooldownSec, connectedDevice]);


  const handleForceDisconnect = () => {
    const ipcRenderer = getDesktopBridge();
    if (ipcRenderer) {
      try {
        ipcRenderer.send('force-disconnect-client');
      } catch (e) {}
    }
    setConnectedDevice(null);
    setStatus('LISTENING_FOR_CLIENT');
    addLog('SYSTEM', 'Host forcibly terminated active mobile client connection', 'warning');
    setIsSettingsModalOpen(false);
  };

  const handleRevokeToken = async (token: string) => {
    const ipcRenderer = getDesktopBridge();
    if (ipcRenderer) {
      try {
        const result = await ipcRenderer.invoke('revoke-token', token);
        if (result?.status === 'SUCCESS') {
          setApprovedTokens(prev => prev.filter(t => t.token !== token));
          addLog('SYSTEM', 'Revoked trusted device session token via Host UI', 'warning');
        }
      } catch (e) {}
    } else {
      setApprovedTokens(prev => prev.filter(t => t.token !== token));
    }
  };

  return (
    <div data-theme={theme} className={`aether-app min-h-screen px-4 py-5 sm:px-8 sm:py-7 font-body transition-colors duration-300 selection:bg-orange-500/25 ${
      theme === 'light' ? 'is-light text-slate-900' : 'text-white'
    }`}>
      <div className="aether-ambient fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <GradientBackground className="aether-orange-orb absolute -right-[18rem] -top-[24rem] h-[48rem] w-[48rem] rounded-full opacity-55 blur-[1px]" />
        <div className="aether-grid absolute inset-0" />
        <div className="aether-beam absolute -left-40 top-24 h-[48rem] w-56 -rotate-[28deg] rounded-full" />
      </div>

      <div className="max-w-6xl mx-auto space-y-6 relative z-10">
        <nav className="aether-nav sticky top-4 z-40 inline-flex items-center gap-1 rounded-full p-1.5" aria-label="Разделы приложения">
          <button onClick={() => setActiveAppTab('main')} className={`aether-nav-item ${activeAppTab === 'main' ? 'is-active' : ''}`}>Главная</button>
          <button onClick={() => setActiveAppTab('deck')} className={`aether-nav-item ${activeAppTab === 'deck' ? 'is-active' : ''}`}>Aether Deck</button>
        </nav>
        {activeAppTab === 'main' ? <>
        {isTrayMinimized && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-center justify-between">
            <span>
              📌 <strong>System Tray Mode Active:</strong> Daemon is running quietly in the background notification area.
            </span>
            <button
              onClick={() => setIsTrayMinimized(false)}
              className="text-white underline hover:text-amber-200 text-xs cursor-pointer"
            >
              Restore Window
            </button>
          </div>
        )}

        <Header
          status={status}
          language={language}
          theme={theme}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
        />

        <MainPairingCard
          pin={pin}
          ipAddress={ipAddress}
          networkEndpoints={networkEndpoints}
          port={port}
          tlsFingerprint={tlsFingerprint}
          language={language}
          theme={theme}
        />

        <SecurityAndStats
          failedAttempts={failedAttempts}
          maxAttempts={3}
          blockedCooldownSec={blockedCooldownSec}
          connectedDevice={connectedDevice}
          stats={stats}
          isBlocked={isBlocked}
          language={language}
          theme={theme}
        />

        <FileExchangePanel language={language} theme={theme} onAddLog={addLog} />

        <ScreenStreamView language={language} theme={theme} isStreaming={stats.isScreenStreaming === true} />

        <AuditLogConsole logs={logs} language={language} theme={theme} onClearLogs={() => setLogs([])} />
        </> : <AetherDeckEditor theme={theme} />}
      </div>

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        language={language}
        onLanguageChange={setLanguage}
        theme={theme}
        onThemeChange={setTheme}
        autoStart={autoStart}
        onAutoStartChange={setAutoStart}
        minimizeToTray={minimizeToTray}
        onMinimizeToTrayChange={setMinimizeToTray}
        isConnected={status === 'CLIENT_CONNECTED' || connectedDevice !== null}
        onForceDisconnect={handleForceDisconnect}
        approvedTokens={approvedTokens}
        onRevokeToken={handleRevokeToken}
      />

      {pendingApprovals.length > 0 && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-fade-in">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-sky-500 to-indigo-500" />
            
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="p-3 bg-sky-500/10 rounded-full border border-sky-500/20 text-sky-400">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 animate-pulse">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
                </svg>
              </div>
              
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-neutral-100">
                  {pendingApprovals[0].type === 'command'
                    ? (language === 'RU' ? 'Подтверждение команды' : 'Command Approval')
                    : (language === 'RU' ? 'Запрос на подключение' : 'Connection Request')}
                </h3>
                <p className="text-sm text-neutral-400">
                  {pendingApprovals[0].type === 'command'
                    ? (language === 'RU' ? 'Удалённое устройство запрашивает выполнение команды на этом ПК.' : 'A remote device is requesting command execution on this PC.')
                    : (language === 'RU' ? 'Новое устройство пытается подключиться к этому хосту.' : 'A new device is attempting to pair with this host.')}
                </p>
              </div>
              
              <div className="w-full bg-neutral-950 border border-neutral-800/80 rounded-xl p-4 text-left space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-500">{language === 'RU' ? 'Устройство:' : 'Device:'}</span>
                  <span className="text-neutral-200 font-medium text-right break-words min-w-0">{pendingApprovals[0].deviceModel}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-500">IP адрес:</span>
                  <span className="text-neutral-200 font-mono font-medium">{pendingApprovals[0].ip}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-500">{language === 'RU' ? 'Протокол:' : 'Protocol:'}</span>
                  <span className="text-neutral-200 uppercase font-medium">{pendingApprovals[0].type}</span>
                </div>
              </div>

              {pendingApprovals[0].type === 'pairing' && (
                <label className="w-full flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-left cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pendingApprovals[0].trusted === true}
                    onChange={(event) => setPendingApprovals(current => current.map(item =>
                      item.id === pendingApprovals[0].id ? { ...item, trusted: event.target.checked } : item
                    ))}
                    className="h-4 w-4 accent-sky-500"
                  />
                  <span className="text-xs text-neutral-300">
                    {language === 'RU' ? 'Сделать телефон доверенным' : 'Trust this phone'}
                  </span>
                </label>
              )}
              
              <div className="flex w-full gap-3 pt-2">
                <button
                  onClick={() => pendingApprovals[0].onResolve(false, false)}
                  className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-800 border border-neutral-700 text-neutral-200 text-sm font-semibold rounded-xl transition duration-150 cursor-pointer"
                >
                  {language === 'RU' ? 'Отклонить' : 'Decline'}
                </button>
                <button
                  onClick={() => pendingApprovals[0].onResolve(true, pendingApprovals[0].trusted === true)}
                  className="flex-1 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-sm font-semibold rounded-xl transition duration-150 shadow-lg shadow-sky-600/15 cursor-pointer"
                >
                  {pendingApprovals[0].type === 'pairing'
                    ? (language === 'RU' ? 'Подключить' : 'Connect')
                    : (language === 'RU' ? 'Разрешить' : 'Approve')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
