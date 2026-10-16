import React, { useEffect } from 'react';
import { Settings, X, Power, Sun, Moon, Globe, ShieldAlert, Cpu, Minimize2, FolderOpen, FolderCog } from 'lucide-react';
import { Language, translations } from '../data/translations';
import { getDesktopBridge } from '../platform/desktopBridge';
import { AccountPanel } from './AccountPanel';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
  autoStart: boolean;
  onAutoStartChange: (enabled: boolean) => void;
  minimizeToTray: boolean;
  onMinimizeToTrayChange: (enabled: boolean) => void;
  isConnected: boolean;
  onForceDisconnect: () => void;
  approvedTokens: any[];
  onRevokeToken: (token: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  language,
  onLanguageChange,
  theme,
  onThemeChange,
  autoStart,
  onAutoStartChange,
  minimizeToTray,
  onMinimizeToTrayChange,
  isConnected,
  onForceDisconnect,
  approvedTokens = [],
  onRevokeToken,
}) => {
  const [clipboardSharing, setClipboardSharing] = React.useState({ enabled: false, recipients: 0 });
  const [clipboardError, setClipboardError] = React.useState('');
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const refresh = () => getDesktopBridge()?.invoke('get-clipboard-sharing').then(result => {
      if (active && typeof result?.enabled === 'boolean') setClipboardSharing(result);
    }).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [isOpen]);
  const toggleClipboardSharing = async () => {
    try {
      const result = await getDesktopBridge()?.invoke('set-clipboard-sharing', !clipboardSharing.enabled);
      if (!result) throw new Error('Unavailable');
      setClipboardSharing(result);
      setClipboardError('');
    } catch (_) { setClipboardError(language === 'RU' ? 'Не удалось сохранить настройку' : 'Could not save preference'); }
  };
  const [downloadFolder, setDownloadFolder] = React.useState('Downloads\\AetherRemote');
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const ipc = getDesktopBridge();
    ipc?.invoke('get-download-folder').then((result: any) => {
      if (result?.path) setDownloadFolder(result.path);
    }).catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;
  const t = translations[language];
  const trustedTokens = approvedTokens.filter(device => device?.trusted === true);

  const handleDisconnectClick = () => {
    if (window.confirm(t.disconnectConfirm)) {
      onForceDisconnect();
    }
  };

  const isLight = theme === 'light';
  const chooseDownloadFolder = async () => {
    const result = await getDesktopBridge()?.invoke('select-download-folder');
    if (result?.path) setDownloadFolder(result.path);
  };
  const openDownloadFolder = () => getDesktopBridge()?.invoke('open-download-folder');

  return (
    <div className={`settings-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden overscroll-contain backdrop-blur-xl animate-fade-in ${
      isLight ? 'bg-orange-950/25' : 'bg-black/85'
    }`}>
      <div 
        className={`settings-panel w-full max-w-2xl max-h-[calc(100dvh-2rem)] rounded-[2rem] p-5 sm:p-7 shadow-2xl relative border transition-all duration-300 flex flex-col overflow-hidden ${
          isLight 
            ? 'is-light liquid-glass-light-strong text-slate-900'
            : 'liquid-glass-strong text-white'
        }`}
      >
        <div className={`flex shrink-0 items-center justify-between pb-4 border-b ${
          isLight ? 'border-slate-200' : 'border-white/10'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${
              isLight ? 'bg-slate-100 border-slate-200' : 'bg-white/10 border-white/15'
            }`}>
              <Settings className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h2 className={`font-heading italic text-xl tracking-wide ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}>
                {t.settingsTitle}
              </h2>
              <p className={`mt-0.5 text-[10px] uppercase tracking-[0.2em] ${isLight ? 'text-orange-800/55' : 'text-orange-200/45'}`}>
                Aether Remote 2.1.0
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isLight
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900'
                : 'bg-white/5 hover:bg-white/15 text-white/70 hover:text-white'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="settings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain py-6 pr-2 space-y-5">
          <AccountPanel theme={theme} />
          <div className={`p-4 rounded-xl border space-y-3 ${isLight ? 'bg-slate-100/70 border-slate-200' : 'bg-white/5 border-white/10'}`}>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
              <FolderCog className="w-4 h-4 text-emerald-500" />
              {language === 'RU' ? 'Папка загрузок' : 'Download folder'}
            </div>
            <p className={`truncate text-[11px] font-mono ${isLight ? 'text-slate-500' : 'text-white/50'}`} title={downloadFolder}>{downloadFolder}</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={chooseDownloadFolder} className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400 hover:bg-emerald-500/15"><FolderCog className="w-4 h-4"/>{language === 'RU' ? 'Выбрать папку' : 'Choose folder'}</button>
              <button onClick={openDownloadFolder} className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs ${isLight ? 'border-slate-200 bg-white text-slate-700' : 'border-white/10 bg-white/5 text-white/75'}`}><FolderOpen className="w-4 h-4"/>{language === 'RU' ? 'Открыть папку' : 'Open folder'}</button>
            </div>
          </div>
          <div className={`p-4 rounded-xl border space-y-3 ${
            isLight ? 'bg-red-500/10 border-red-500/20' : 'bg-red-500/10 border-red-500/20'
          }`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
                isLight ? 'text-red-700' : 'text-red-300'
              }`}>
                <ShieldAlert className="w-4 h-4 text-red-500" />
                {t.forceDisconnect}
              </span>
              <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                isConnected 
                  ? isLight ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : isLight ? 'bg-slate-100 text-slate-500' : 'bg-white/5 text-white/40'
              }`}>
                {isConnected ? '1 Client Active' : '0 Connected'}
              </span>
            </div>

            {!isConnected && <p className={`text-xs ${isLight ? 'text-slate-600' : 'text-white/60'}`}>{t.noClientConnected}</p>}

            <button
              onClick={handleDisconnectClick}
              disabled={!isConnected}
              className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-xs transition-all ${
                isConnected
                  ? 'bg-red-500 hover:bg-red-600 text-white cursor-pointer shadow-lg shadow-red-500/20'
                  : isLight 
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
                    : 'bg-white/5 text-white/30 cursor-not-allowed border border-white/5'
              }`}
            >
              <Power className="w-4 h-4" />
              <span>{t.forceDisconnect}</span>
            </button>
          </div>

          <div className={`p-4 rounded-xl border flex items-center justify-between transition-all ${
            isLight ? 'bg-slate-100/70 border-slate-200' : 'bg-white/5 border-white/10'
          }`}>
            <div className="space-y-0.5 pr-4">
              <div className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
                isLight ? 'text-slate-800' : 'text-white/90'
              }`}>
                <Cpu className="w-4 h-4 text-emerald-500" />
                {t.autoStartLabel}
              </div>
              <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
                {t.autoStartDesc}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onAutoStartChange(!autoStart)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                autoStart ? 'bg-emerald-500' : isLight ? 'bg-slate-300' : 'bg-white/20'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  autoStart ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className={`p-4 rounded-xl border flex items-center justify-between transition-all ${
            isLight ? 'bg-slate-100/70 border-slate-200' : 'bg-white/5 border-white/10'
          }`}>
            <div className="space-y-0.5 pr-4">
              <div className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
                isLight ? 'text-slate-800' : 'text-white/90'
              }`}>
                <Minimize2 className="w-4 h-4 text-sky-500" />
                {t.minimizeToTrayLabel}
              </div>
              <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
                {t.minimizeToTrayDesc}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onMinimizeToTrayChange(!minimizeToTray)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                minimizeToTray ? 'bg-emerald-500' : isLight ? 'bg-slate-300' : 'bg-white/20'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  minimizeToTray ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className={`p-4 rounded-xl border space-y-3 transition-all ${
            isLight ? 'bg-slate-100/70 border-slate-200' : 'bg-white/5 border-white/10'
          }`}>
            <div className={`flex items-center justify-between pb-1.5 border-b ${
              isLight ? 'border-slate-200' : 'border-white/5'
            }`}>
              <span className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
                isLight ? 'text-slate-800' : 'text-white/90'
              }`}>
                <ShieldAlert className="w-4 h-4 text-sky-500" />
                {language === 'RU' ? 'Доверенные телефоны' : 'Trusted Phones'}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                trustedTokens.length > 0
                  ? 'bg-sky-500/15 text-sky-300'
                  : 'bg-white/5 text-white/30'
              }`}>
                {trustedTokens.length}
              </span>
            </div>

            {trustedTokens.length === 0 ? (
              <p className={`text-[11px] italic text-center py-2 ${isLight ? 'text-slate-500' : 'text-white/40'}`}>
                {language === 'RU' ? 'Нет доверенных устройств' : 'No trusted devices paired yet'}
              </p>
            ) : (
              <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                {trustedTokens.map((device) => (
                  <div 
                    key={device.token}
                    className={`flex items-center justify-between p-2 rounded-lg text-xs ${
                      isLight ? 'bg-slate-200/50' : 'bg-black/40'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="font-semibold text-[11px] truncate max-w-[200px]">
                        {device.deviceName || 'Aether Mobile Client'}
                      </div>
                      <div className="text-[10px] opacity-60 font-mono">
                        {device.ipAddress} • {language === 'RU' ? 'Последнее подключение: ' : 'Last connected: '}{device.lastUsedAt ? new Date(device.lastUsedAt).toLocaleString() : (language === 'RU' ? 'нет данных' : 'unknown')}
                      </div>
                    </div>
                    <button
                      onClick={() => onRevokeToken(device.token)}
                      className="px-2.5 py-1 text-[10px] font-bold tracking-wider rounded bg-red-500/15 hover:bg-red-500/25 text-red-400 hover:text-red-300 transition duration-150 uppercase cursor-pointer"
                    >
                      {language === 'RU' ? 'ОТЗЫВ' : 'REVOKE'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/10 p-4 space-y-2">
            <label className="flex items-center justify-between gap-4 text-sm">
              {language === 'RU' ? 'Передавать историю буфера обмена' : 'Share clipboard history'}
              <input type="checkbox" checked={clipboardSharing.enabled} onChange={toggleClipboardSharing} />
            </label>
            <p className="text-xs opacity-70">{language === 'RU'
              ? `Буфер обмена транслируется ${clipboardSharing.recipients} устройствам. При включении подключённые телефоны получают скопированный текст, включая пароли и коды.`
              : `Clipboard is shared with ${clipboardSharing.recipients} devices. When enabled, connected phones receive copied text, including passwords and codes.`}</p>
            {clipboardError && <p role="alert" className="text-xs text-red-400">{clipboardError}</p>}
          </div>
          <div className="appearance-section space-y-3 rounded-2xl border p-4">
            <label className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
              isLight ? 'text-slate-700' : 'text-white/70'
            }`}>
              <Sun className="w-4 h-4 text-orange-500" />
              {t.themeLabel}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => onThemeChange('dark')}
                className={`theme-preview theme-preview-dark ${theme === 'dark' ? 'is-selected' : ''}`}
              >
                <span className="theme-preview-icon"><Moon className="w-5 h-5" /></span>
                <span className="text-left"><strong>{t.darkGlass}</strong><small>{language === 'RU' ? 'Глубокий чёрный' : 'Deep black'}</small></span>
              </button>

              <button
                onClick={() => onThemeChange('light')}
                className={`theme-preview theme-preview-light ${theme === 'light' ? 'is-selected' : ''}`}
              >
                <span className="theme-preview-icon"><Sun className="w-5 h-5" /></span>
                <span className="text-left"><strong>{t.lightGlass}</strong><small>{language === 'RU' ? 'Тёплый оранжевый' : 'Warm orange'}</small></span>
              </button>
            </div>
            <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-white/45'}`}>
              {language === 'RU' ? 'Тема применяется сразу и сохраняется после перезапуска.' : 'Theme applies instantly and persists after restart.'}
            </p>
          </div>

          <div className="space-y-2">
            <label className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
              isLight ? 'text-slate-700' : 'text-white/70'
            }`}>
              <Globe className="w-4 h-4 text-emerald-500" />
              {t.languageLabel}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => onLanguageChange('EN')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                  language === 'EN'
                    ? isLight
                      ? 'bg-emerald-50 border-emerald-500/50 text-emerald-800 ring-2 ring-emerald-500/20 font-semibold'
                      : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 ring-1 ring-emerald-500/40'
                    : isLight
                      ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200/80'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                <span className="font-bold font-mono">EN</span>
                <span>English</span>
              </button>

              <button
                onClick={() => onLanguageChange('RU')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                  language === 'RU'
                    ? isLight
                      ? 'bg-emerald-50 border-emerald-500/50 text-emerald-800 ring-2 ring-emerald-500/20 font-semibold'
                      : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 ring-1 ring-emerald-500/40'
                    : isLight
                      ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200/80'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                <span className="font-bold font-mono">RU</span>
                <span>Русский</span>
              </button>
            </div>
          </div>
        </div>

        <div className={`shrink-0 pt-4 border-t flex justify-end ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
          <button
            onClick={onClose}
            className={`px-5 py-2 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
              isLight
                ? 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800'
                : 'bg-white/10 hover:bg-white/20 border-white/15 text-white'
            }`}
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
};
