import React, { useEffect, useState } from 'react';
import { getDesktopBridge } from '../platform/desktopBridge';
import { ShieldAlert, Cpu, HardDrive, Smartphone, Activity, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { ConnectedDeviceInfo, SystemStats } from '../types';
import { Language, translations } from '../data/translations';

interface SecurityAndStatsProps {
  failedAttempts: number;
  maxAttempts: number;
  blockedCooldownSec: number;
  connectedDevice: ConnectedDeviceInfo | null;
  stats: SystemStats;
  isBlocked: boolean;
  language?: Language;
  theme?: 'dark' | 'light';
}

export const SecurityAndStats: React.FC<SecurityAndStatsProps> = ({
  failedAttempts,
  maxAttempts,
  blockedCooldownSec,
  connectedDevice,
  stats,
  isBlocked,
  language = 'RU',
  theme = 'dark',
}) => {
  const [clipboardSharing, setClipboardSharing] = useState({ enabled: false, recipients: 0 });
  useEffect(() => {
    let active = true;
    const refresh = () => getDesktopBridge()?.invoke('get-clipboard-sharing').then(result => {
      if (active && typeof result?.enabled === 'boolean') setClipboardSharing(result);
    }).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const isLight = theme === 'light';
  const t = translations[language];

  return (
    <div className="grid grid-cols-1 gap-4">
      {clipboardSharing.enabled && <div role="status" className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-3 text-xs">
        {language === 'RU' ? `Буфер обмена транслируется ${clipboardSharing.recipients} устройствам` : `Clipboard is shared with ${clipboardSharing.recipients} devices`}
      </div>}
      <div className="hidden">
        <div className="flex items-center justify-between mb-3">
          <span className={`text-xs uppercase tracking-widest font-body font-semibold flex items-center gap-1.5 ${
            isLight ? 'text-slate-500' : 'text-white/40'
          }`}>
            <ShieldAlert className={`w-4 h-4 ${isLight ? 'text-slate-600' : 'text-white/60'}`} />
            {t.antiBruteGuard}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded font-mono ${
            isBlocked
              ? 'bg-red-500/20 text-red-600 border border-red-500/30 font-semibold'
              : failedAttempts > 0
              ? 'bg-amber-500/20 text-amber-600 border border-amber-500/30 font-semibold'
              : isLight
              ? 'bg-slate-200/80 text-slate-600 border border-slate-300'
              : 'bg-white/5 text-white/60'
          }`}>
            {failedAttempts} / {maxAttempts} {t.fails}
          </span>
        </div>

        {isBlocked ? (
          <div className={`p-3 border rounded-lg text-xs mb-2 font-mono ${
            isLight
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}>
            {t.ipBlockedCooldown} {blockedCooldownSec} {t.remainingSec}
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-2">
            <div className={`flex-1 h-2 rounded-full overflow-hidden border ${
              isLight ? 'bg-slate-200 border-slate-300' : 'bg-white/5 border-white/10'
            }`}>
              <div
                className={`h-full transition-all duration-300 ${
                  failedAttempts >= 2 ? 'bg-red-500' : failedAttempts === 1 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${(failedAttempts / maxAttempts) * 100}%` }}
              />
            </div>
            <span className={`text-[11px] font-mono ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
              {failedAttempts === 0 ? t.secure : `${maxAttempts - failedAttempts} ${t.left}`}
            </span>
          </div>
        )}

        <div className={`mt-2 pt-2 border-t flex items-center justify-between text-xs ${
          isLight ? 'border-slate-200' : 'border-white/10'
        }`}>
          <span className={`flex items-center gap-1.5 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
            <Smartphone className={`w-3.5 h-3.5 ${isLight ? 'text-slate-400' : 'text-white/40'}`} />
            {t.activeClient}
          </span>
          <span className={`font-medium ${isLight ? 'text-slate-900' : 'text-white'}`}>
            {connectedDevice ? (
              <span className="text-emerald-600 flex items-center gap-1 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                {connectedDevice.deviceModel} ({connectedDevice.ipAddress})
              </span>
            ) : (
              <span className={isLight ? 'text-slate-400' : 'text-white/40'}>{t.noDeviceConnected}</span>
            )}
          </span>
        </div>
      </div>

      <div className={`${isLight ? 'liquid-glass-light border-slate-200' : 'liquid-glass border-white/10'} rounded-xl p-5 flex flex-col justify-between transition-all duration-300`}>
        <div className="flex items-center justify-between mb-3">
          <span className={`text-xs uppercase tracking-widest font-body font-semibold flex items-center gap-1.5 ${
            isLight ? 'text-slate-500' : 'text-white/40'
          }`}>
            <Activity className={`w-4 h-4 ${isLight ? 'text-slate-600' : 'text-white/60'}`} />
            {t.liveSystemTelemetry}
          </span>
          <span className={`text-[11px] font-mono ${isLight ? 'text-slate-500' : 'text-white/40'}`}>
            {stats.hostname}
          </span>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className={`flex items-center gap-1 ${isLight ? 'text-slate-700' : 'text-white/70'}`}>
                  <Cpu className={`w-3.5 h-3.5 ${isLight ? 'text-slate-500' : 'text-white/50'}`} />
                  {t.cpuLoad}
                </span>
                <span className={`font-mono ${isLight ? 'text-slate-900 font-semibold' : 'text-white/90'}`}>{stats.cpuUsage}%</span>
              </div>
              <div className={`w-full h-1.5 rounded-full overflow-hidden border ${
                isLight ? 'bg-slate-200 border-slate-300' : 'bg-white/5 border-white/10'
              }`}>
                <div
                  className={`h-full transition-all duration-500 ${isLight ? 'bg-slate-800' : 'bg-white'}`}
                  style={{ width: `${stats.cpuUsage}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className={`flex items-center gap-1 ${isLight ? 'text-slate-700' : 'text-white/70'}`}>
                  <HardDrive className={`w-3.5 h-3.5 ${isLight ? 'text-slate-500' : 'text-white/50'}`} />
                  {t.ram}
                </span>
                <span className={`font-mono ${isLight ? 'text-slate-900 font-semibold' : 'text-white/90'}`}>{stats.ramUsage}%</span>
              </div>
              <div className={`w-full h-1.5 rounded-full overflow-hidden border ${
                isLight ? 'bg-slate-200 border-slate-300' : 'bg-white/5 border-white/10'
              }`}>
                <div
                  className={`h-full transition-all duration-500 ${isLight ? 'bg-slate-700' : 'bg-white/80'}`}
                  style={{ width: `${stats.ramUsage}%` }}
                />
              </div>
            </div>
          </div>

          <div className={`pt-2 border-t flex items-center justify-between text-xs font-mono ${
            isLight ? 'border-slate-200 text-slate-700' : 'border-white/10 text-white/70'
          }`}>
            <div className="flex items-center gap-1.5">
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500" />
              <span>{t.download}: {stats.netDownloadMb} {language === 'RU' ? 'МБ/с' : 'MB/s'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ArrowUpRight className="w-3.5 h-3.5 text-sky-500" />
              <span>{t.upload}: {stats.netUploadMb} {language === 'RU' ? 'МБ/с' : 'MB/s'}</span>
            </div>
          </div>

          {stats.track && (
            <div className={`mt-2.5 pt-2 border-t flex items-center justify-between text-xs ${
              isLight ? 'border-slate-200' : 'border-white/10'
            }`}>
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="relative flex items-center justify-center w-7 h-7 rounded bg-emerald-500/10 text-emerald-500 shrink-0">
                  <span className={`w-2 h-2 rounded-full bg-emerald-500 ${stats.isPlaying ? 'animate-ping' : ''}`} />
                </div>
                <div className="truncate text-left">
                  <p className={`font-semibold truncate text-[11px] ${isLight ? 'text-slate-900' : 'text-white'}`}>
                    {stats.track}
                  </p>
                  <p className={`text-[10px] truncate ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
                    {stats.artist || 'Unknown Artist'}
                  </p>
                </div>
              </div>
              <span className={`text-[9px] px-2 py-0.5 rounded font-mono font-semibold uppercase tracking-wider ${
                stats.isPlaying 
                  ? 'bg-emerald-500/25 text-emerald-500 dark:text-emerald-400 border border-emerald-500/30'
                  : isLight ? 'bg-slate-200 text-slate-500' : 'bg-white/5 text-white/40'
              }`}>
                {stats.isPlaying ? (language === 'RU' ? 'ИГРАЕТ' : 'PLAYING') : (language === 'RU' ? 'ПАУЗА' : 'PAUSED')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
