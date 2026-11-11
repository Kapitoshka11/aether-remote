import React, { useRef, useEffect } from 'react';
import { Terminal, Trash2 } from 'lucide-react';
import { AuditLogEntry } from '../types';
import { Language, translations } from '../data/translations';

interface AuditLogConsoleProps {
  logs: AuditLogEntry[];
  language?: Language;
  theme?: 'dark' | 'light';
  onClearLogs: () => void;
}

export const AuditLogConsole: React.FC<AuditLogConsoleProps> = ({ logs, language = 'RU', theme = 'dark', onClearLogs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isLight = theme === 'light';
  const t = translations[language];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getStatusColor = (status: AuditLogEntry['status']) => {
    switch (status) {
      case 'success':
        return isLight ? 'text-emerald-700 font-bold' : 'text-emerald-400 font-semibold';
      case 'warning':
        return isLight ? 'text-amber-700 font-bold' : 'text-amber-400 font-semibold';
      case 'error':
        return isLight ? 'text-red-700 font-bold' : 'text-red-400 font-semibold';
      case 'info':
      default:
        return isLight ? 'text-sky-700 font-bold' : 'text-sky-400 font-semibold';
    }
  };

  return (
    <div className={`${isLight ? 'liquid-glass-light border-slate-200' : 'liquid-glass border-white/10'} rounded-xl p-5 flex flex-col h-64 border transition-all duration-300`}>
      <div className={`flex items-center justify-between mb-3 pb-2 border-b ${
        isLight ? 'border-slate-200' : 'border-white/10'
      }`}>
        <div className="flex items-center gap-2">
          <Terminal className={`w-4 h-4 ${isLight ? 'text-slate-600' : 'text-white/60'}`} />
          <span className={`text-xs uppercase tracking-widest font-body font-semibold ${
            isLight ? 'text-slate-600' : 'text-white/50'
          }`}>
            {t.liveAuditLog}
          </span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
            isLight ? 'bg-slate-200 text-slate-700' : 'bg-white/10 text-white/70'
          }`}>
            {logs.length} {t.events}
          </span>
        </div>

        <button
          onClick={onClearLogs}
          className={`flex items-center gap-1 text-[11px] transition-colors cursor-pointer py-1 px-2 rounded ${
            isLight
              ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/60'
              : 'text-white/40 hover:text-white hover:bg-white/5'
          }`}
          title={t.clearLog}
        >
          <Trash2 className="w-3 h-3" />
          <span>{t.clearLog}</span>
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-1.5 font-mono-code text-xs pr-2 select-text"
      >
        {logs.length === 0 ? (
          <div className={`${isLight ? 'text-slate-400' : 'text-white/30'} text-center py-10 italic`}>
            {t.consoleWaiting}
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className={`flex items-start gap-2 p-1 rounded transition-colors ${
                isLight ? 'hover:bg-slate-100/80' : 'hover:bg-white/[0.02]'
              }`}
            >
              <span className={`shrink-0 font-sans text-[11px] ${isLight ? 'text-slate-400' : 'text-white/30'}`}>[{log.timestamp}]</span>
              <span className={`shrink-0 ${getStatusColor(log.status)}`}>[{log.type}]</span>
              <span className={`break-all ${isLight ? 'text-slate-800 font-medium' : 'text-white/80'}`}>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
