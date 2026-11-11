import React from 'react';
import { Monitor, Settings } from 'lucide-react';
import { ConnectionStatus } from '../types';
import { Language, translations } from '../data/translations';
import { TypewriterEffectSmooth } from './ui/typewriter-effect';

interface HeaderProps {
  status: ConnectionStatus;
  language: Language;
  theme?: 'dark' | 'light';
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  language,
  theme = 'dark',
  onOpenSettings,
}) => {
  const t = translations[language];
  const isLight = theme === 'light';

  const getStatusBadge = () => {
    switch (status) {
      case 'CLIENT_CONNECTED':
        return (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold tracking-wide ${
            isLight 
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700' 
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
          }`}>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {t.statusConnected}
          </div>
        );
      case 'BLOCKED_BRUTE_FORCE':
        return (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold tracking-wide animate-pulse ${
            isLight
              ? 'bg-red-500/15 border-red-500/30 text-red-700'
              : 'bg-red-500/20 border-red-500/40 text-red-400'
          }`}>
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {t.statusBlocked}
          </div>
        );
      default:
        return (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium tracking-wide ${
            isLight
              ? 'bg-slate-200/80 border-slate-300 text-slate-700'
              : 'bg-white/5 border-white/10 text-white/70'
          }`}>
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse-slow" />
            {t.statusListening}
          </div>
        );
    }
  };

  return (
    <header className="aether-hero flex flex-col sm:flex-row items-start sm:items-end justify-between gap-7 px-1 pb-8 pt-5 sm:pt-8">
      <div className="flex items-start gap-4">
        <div className="aether-logo-mark mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
          <Monitor className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-orange-300">Control without distance</p>
          <h1 className={`font-heading italic text-5xl sm:text-7xl tracking-[-0.04em] leading-[0.86] ${
            isLight ? 'text-slate-900' : 'text-white'
          }`}>
            {t.appTitle}
          </h1>
          <TypewriterEffectSmooth
            words={language === 'RU'
              ? [{ text: 'Телефон.' }, { text: 'ПК.' }, { text: 'В одном ритме.', className: 'text-orange-400' }]
              : [{ text: 'Phone.' }, { text: 'PC.' }, { text: 'One rhythm.', className: 'text-orange-400' }]}
            className={`mt-4 text-sm sm:text-base ${isLight ? 'text-slate-600' : 'text-white/60'}`}
            cursorClassName="text-orange-400"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end">
        {getStatusBadge()}

        <button
          onClick={onOpenSettings}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
            isLight
              ? 'bg-orange-500/15 hover:bg-orange-500/25 border-orange-500/30 text-orange-800'
              : 'bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/30 text-orange-200'
          }`}
          title={t.settings}
        >
          <Settings className="w-3.5 h-3.5 text-orange-500" />
          <span>{t.settings}</span>
        </button>

      </div>
    </header>
  );
};
