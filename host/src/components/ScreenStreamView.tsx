import React, { useState, useEffect, useRef } from 'react';
import { Pause, Eye, Sparkles } from 'lucide-react';
import { Language, translations } from '../data/translations';

interface ScreenStreamViewProps {
  language?: Language;
  theme?: 'dark' | 'light';
  isStreaming: boolean;
  previewFrame?: string | null;
  fps?: number;
  latencyMs?: number;
}

export const ScreenStreamView: React.FC<ScreenStreamViewProps> = ({
  language = 'RU',
  theme = 'dark',
  isStreaming,
  previewFrame = null,
  fps: externalFps,
  latencyMs: externalLatency,
}) => {
  const [quality] = useState(70);
  const [fps, setFps] = useState(0);
  const [latency, setLatency] = useState(0);
  const [capturedFrame, setCapturedFrame] = useState<string | null>(null);
  const frameCountRef = useRef(0);
  const lastSampleAtRef = useRef(Date.now());
  const isLight = theme === 'light';
  const t = translations[language];
  const activeFrame = previewFrame || capturedFrame;

  useEffect(() => {
    if (typeof externalFps === 'number') setFps(externalFps);
  }, [externalFps]);

  useEffect(() => {
    if (typeof externalLatency === 'number') setLatency(externalLatency);
  }, [externalLatency]);

  useEffect(() => {
    if (activeFrame) {
      frameCountRef.current += 1;
      const now = Date.now();
      const elapsed = now - lastSampleAtRef.current;
      if (elapsed >= 1000 && typeof externalFps !== 'number') {
        setFps(Math.max(1, Math.round((frameCountRef.current * 1000) / elapsed)));
        frameCountRef.current = 0;
        lastSampleAtRef.current = now;
      }
    }
  }, [activeFrame, externalFps]);

  useEffect(() => {
    if (!isStreaming) {
      setCapturedFrame(null);
      setFps(0);
      return;
    }
    if (previewFrame) return;

    let cancelled = false;
    let inFlight = false;
    const pollPreview = async () => {
      if (cancelled || inFlight) return;
      const bridge = (window as any).__TAURI__?.core;
      if (!bridge?.invoke) return;
      inFlight = true;
      const started = performance.now();
      try {
        const res = await bridge.invoke('ipc_invoke', { channel: 'capture-screen', args: [] });
        if (!cancelled && res && typeof res.image === 'string' && res.image.length > 0) {
          setCapturedFrame(res.image);
          if (typeof externalLatency !== 'number') {
            setLatency(Math.max(1, Math.round(performance.now() - started)));
          }
        }
      } catch {
      } finally {
        inFlight = false;
      }
    };

    void pollPreview();
    const timer = window.setInterval(pollPreview, 250);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isStreaming, previewFrame, externalLatency]);

  return (
    <div className={`${isLight ? 'liquid-glass-light border-slate-200' : 'liquid-glass border-white/10'} rounded-xl p-5 border flex flex-col gap-4 transition-all duration-300 relative`}>
      <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${
        isLight ? 'border-slate-200' : 'border-white/10'
      }`}>
        <div className="flex items-center gap-2">
          <Eye className={`w-4 h-4 ${isLight ? 'text-slate-600' : 'text-white/70'}`} />
          <span className={`text-xs uppercase tracking-widest font-body font-semibold ${
            isLight ? 'text-slate-600' : 'text-white/50'
          }`}>
            {t.primaryScreenStream}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 text-xs font-mono px-2.5 py-1 rounded border ${
            isLight ? 'bg-slate-100 text-slate-800 border-slate-200' : 'bg-black/40 text-white/70 border-white/10'
          }`}>
            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
            <span>{fps} FPS</span>
            <span className={isLight ? 'text-slate-300' : 'text-white/20'}>|</span>
            <span>{latency} {language === 'RU' ? 'мс' : 'ms'}</span>
          </div>

          <div
            role="status"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-medium ${
              isStreaming
                ? isLight
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : isLight
                  ? 'bg-slate-500/10 border-slate-500/30 text-slate-600'
                  : 'bg-white/5 border-white/10 text-white/60'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-emerald-500 animate-pulse' : 'bg-white/30'}`} />
            <span>{isStreaming ? (language === 'RU' ? 'Стрим запущен' : 'Stream running') : (language === 'RU' ? 'Стрим выключен' : 'Stream off')}</span>
          </div>
        </div>
      </div>

      <div className={`relative rounded-lg overflow-hidden bg-black border flex items-center justify-center min-h-[240px] ${
        isLight ? 'border-slate-300 shadow-inner' : 'border-white/10'
      }`}>
        {activeFrame ? (
          <img
            src={`data:image/jpeg;base64,${activeFrame}`}
            alt={language === 'RU' ? 'Трансляция экрана' : 'Live screen preview'}
            className="w-full max-h-[340px] object-contain"
          />
        ) : (
          <div className="h-[240px] w-full flex flex-col items-center justify-center text-white/50 text-xs font-mono gap-2">
            <Pause className="w-8 h-8 text-white/30" />
            <span>
              {isStreaming
                ? (language === 'RU' ? 'Захват экрана активен…' : 'Screen capture active…')
                : (language === 'RU' ? 'Стрим выключен' : 'Stream off')}
            </span>
          </div>
        )}

        <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded border border-white/10 text-[10px] font-mono text-white/70">
          {language === 'RU' ? `Live JPEG ${quality}%` : `Live JPEG ${quality}%`}
        </div>
      </div>
    </div>
  );
};
