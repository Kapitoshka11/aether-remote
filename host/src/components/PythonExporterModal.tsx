import React, { useState } from 'react';
import { Copy, Check, Download, Terminal, Code, X } from 'lucide-react';
import { PYTHON_HOST_AGENT_CODE } from '../data/pythonCode';

interface PythonExporterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PythonExporterModal: React.FC<PythonExporterModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(PYTHON_HOST_AGENT_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([PYTHON_HOST_AGENT_CODE], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aether_host_daemon.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="liquid-glass-strong w-full max-w-4xl rounded-2xl overflow-hidden border border-white/20 shadow-2xl flex flex-col h-[85vh]">
        <div className="p-5 bg-black/60 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white">
              <Code className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-heading italic text-2xl text-white">
                Windows Python Host Daemon Source Code
              </h2>
              <p className="text-xs text-white/50 font-body">
                Complete, self-contained Python PyQt6 + WebSockets script compiled for Windows PC
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-xs text-white transition-all cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied Source!' : 'Copy Code'}</span>
            </button>

            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black font-semibold text-xs transition-all cursor-pointer hover:bg-white/90"
            >
              <Download className="w-4 h-4" />
              <span>Download .py</span>
            </button>

            <button
              onClick={onClose}
              className="text-white/40 hover:text-white transition-colors cursor-pointer p-1 ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="bg-white/5 border-b border-white/10 px-6 py-3 flex flex-wrap items-center justify-between text-xs text-white/70 font-mono gap-2">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span>Install requirements:</span>
            <code className="bg-black/60 px-2 py-0.5 rounded text-white border border-white/10">
              pip install PyQt6 websockets mss Pillow psutil pyperclip pyttsx3 qrcode[pil]
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span>Compile .exe:</span>
            <code className="bg-black/60 px-2 py-0.5 rounded text-white border border-white/10">
              pyinstaller --noconsole --onefile main.py
            </code>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-black/90 font-mono-code text-xs text-white/80 select-text leading-relaxed">
          <pre>{PYTHON_HOST_AGENT_CODE}</pre>
        </div>
      </div>
    </div>
  );
};
