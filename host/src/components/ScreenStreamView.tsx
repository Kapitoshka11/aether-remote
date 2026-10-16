import React, { useState, useEffect, useRef } from 'react';
import { Pause, Eye, Sparkles } from 'lucide-react';
import { Language, translations } from '../data/translations';

interface ScreenStreamViewProps {
  language?: Language;
  theme?: 'dark' | 'light';
  isStreaming: boolean;
}

export const ScreenStreamView: React.FC<ScreenStreamViewProps> = ({ language = 'RU', theme = 'dark', isStreaming }) => {
  const [quality] = useState(70);
  const [fps, setFps] = useState(60);
  const [latency, setLatency] = useState(14);
  const [mousePos, setMousePos] = useState({ x: 420, y: 220 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isLight = theme === 'light';
  const t = translations[language];

  useEffect(() => {
    if (!isStreaming) return;

    let frameId: number;
    let tick = 0;

    const render = () => {
      tick++;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;

          ctx.fillStyle = '#050505';
          ctx.fillRect(0, 0, w, h);

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
          ctx.lineWidth = 1;
          for (let x = 0; x < w; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
          }
          for (let y = 0; y < h; y += 40) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }

          ctx.fillStyle = 'rgba(15, 15, 15, 0.9)';
          ctx.fillRect(0, h - 36, w, 36);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.fillRect(0, h - 36, w, 1);

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(20, h - 26, 16, 16);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.fillRect(48, h - 26, 16, 16);
          ctx.fillRect(72, h - 26, 16, 16);
          ctx.fillRect(96, h - 26, 16, 16);

          const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          ctx.font = '11px Barlow, sans-serif';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.fillText(nowStr, w - 60, h - 14);

          const winX = 60 + Math.sin(tick * 0.02) * 5;
          const winY = 40 + Math.cos(tick * 0.02) * 3;
          ctx.fillStyle = 'rgba(20, 20, 20, 0.95)';
          ctx.fillRect(winX, winY, w - 180, h - 120);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.lineWidth = 1;
          ctx.strokeRect(winX, winY, w - 180, h - 120);

          ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
          ctx.fillRect(winX, winY, w - 180, 28);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.font = 'italic 12px "Instrument Serif", Georgia, serif';
          ctx.fillText('Aether Remote Host - System Capture [60 FPS JPEG]', winX + 12, winY + 18);

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.beginPath();
          for (let i = 0; i < 200; i += 10) {
            const py = winY + 100 + Math.sin((i + tick * 4) * 0.05) * 20;
            if (i === 0) ctx.moveTo(winX + 20 + i, py);
            else ctx.lineTo(winX + 20 + i, py);
          }
          ctx.stroke();

          const curX = (w / 2) + Math.sin(tick * 0.03) * 140;
          const curY = (h / 2) + Math.cos(tick * 0.04) * 80;
          setMousePos({ x: Math.round(curX), y: Math.round(curY) });

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(curX, curY);
          ctx.lineTo(curX + 12, curY + 12);
          ctx.lineTo(curX + 5, curY + 14);
          ctx.lineTo(curX + 2, curY + 20);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#000000';
          ctx.stroke();
        }
      }

      if (tick % 30 === 0) {
        setFps(Math.floor(58 + Math.random() * 4));
        setLatency(Math.floor(12 + Math.random() * 5));
      }

      frameId = requestAnimationFrame(render);
    };

    frameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameId);
  }, [isStreaming]);

  return (
    <div className={`${isLight ? 'liquid-glass-light border-slate-200' : 'liquid-glass border-white/10'} rounded-xl p-5 border flex flex-col gap-4 transition-all duration-300 relative`}>
        <div className="absolute top-0 right-0 bg-yellow-500/90 text-black px-2 py-0.5 rounded-bl-lg rounded-tr-xl text-[10px] font-bold uppercase tracking-wider z-10">
            DEMO PREVIEW
        </div>
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

      <div className={`relative rounded-lg overflow-hidden bg-black border flex items-center justify-center ${
        isLight ? 'border-slate-300 shadow-inner' : 'border-white/10'
      }`}>
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          className="w-full max-h-[340px] object-contain"
        />

        {!isStreaming && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center text-white/50 text-xs font-mono gap-2">
            <Pause className="w-8 h-8 text-white/30" />
            <span>{language === 'RU' ? 'Стрим выключен' : 'Stream off'}</span>
          </div>
        )}

        <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded border border-white/10 text-[10px] font-mono text-white/70">
          Cursor: ({mousePos.x}, {mousePos.y}) | Mode: JPEG {quality}%
        </div>
      </div>
    </div>
  );
};
