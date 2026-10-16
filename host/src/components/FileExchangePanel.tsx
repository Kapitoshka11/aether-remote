import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileDown, FolderOpen, CheckCircle, Clock, FileText, File, Image as ImageIcon, Music, Video, AlertCircle, RefreshCw } from 'lucide-react';
import { Language } from '../data/translations';
import { upsertReceivedFile, type ReceivedFileRecord } from './receivedFilesModel';
import { getDesktopBridge } from '../platform/desktopBridge';

interface FileExchangePanelProps {
  language: Language;
  theme: 'dark' | 'light';
  onAddLog?: (type: string, message: string, severity?: 'info' | 'warning' | 'error' | 'success') => void;
}

function encodeBase64(bytes: Uint8Array): string {
  const pieces: string[] = [];
  const BLOCK_SIZE = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += BLOCK_SIZE) {
    pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + BLOCK_SIZE)));
  }
  return btoa(pieces.join(''));
}

export const FileExchangePanel: React.FC<FileExchangePanelProps> = ({
  language,
  theme,
  onAddLog
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [sendingFile, setSendingFile] = useState<{ name: string; progress: number; size: number } | null>(null);
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFileRecord[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isRu = language === 'RU';

  useEffect(() => {
    const ipcRenderer = getDesktopBridge();
    if (ipcRenderer) {
      try {
        const handleFileReceived = (_event: any, data: any) => {
          const newFile: ReceivedFileRecord = {
            id: data.fileId || `rec-${Date.now()}`,
            name: data.fileName || 'received_file',
            size: data.fileSize || 0,
            path: data.filePath || 'C:\\Users\\Downloads\\AetherRemote',
            timestamp: data.timestamp || new Date().toLocaleTimeString()
          };
          setReceivedFiles((prev) => upsertReceivedFile(prev, newFile));
          if (onAddLog) {
            onAddLog('FILE_TRANSFER', `Получен файл от смартфона: ${newFile.name}`, 'success');
          }
        };

        ipcRenderer.on('file-received', handleFileReceived);
        return () => {
          ipcRenderer.removeListener('file-received', handleFileReceived);
        };
      } catch (e) {}
    }
  }, [onAddLog]);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) {
      return <ImageIcon className="w-5 h-5 text-sky-400" />;
    }
    if (['mp3', 'wav', 'flac', 'aac', 'm4a'].includes(ext)) {
      return <Music className="w-5 h-5 text-purple-400" />;
    }
    if (['mp4', 'mkv', 'avi', 'mov'].includes(ext)) {
      return <Video className="w-5 h-5 text-rose-400" />;
    }
    if (['pdf', 'txt', 'doc', 'docx', 'xlsx'].includes(ext)) {
      return <FileText className="w-5 h-5 text-emerald-400" />;
    }
    return <File className="w-5 h-5 text-slate-400" />;
  };

  const handleOpenFolder = (filePath?: string) => {
    const ipcRenderer = getDesktopBridge();
    if (ipcRenderer) {
      try {
        ipcRenderer.invoke('open-download-folder', filePath);
        if (onAddLog) {
          onAddLog('SYSTEM', `Открыта директория с полученными файлами`, 'info');
        }
      } catch (e) {}
    } else {
      alert(isRu ? 'Файл сохранен в C:\\Users\\User\\Downloads\\AetherRemote\\' : 'File saved in C:\\Users\\User\\Downloads\\AetherRemote\\');
    }
  };

  const handleProcessFile = async (file: File) => {
    if (file.size > 500 * 1024 * 1024) {
      onAddLog?.('FILE_TRANSFER', `Файл ${file.name} превышает лимит 500 МБ`, 'error');
      return;
    }
    setSendingFile({ name: file.name, progress: 0, size: file.size });
    let transferId = '';

    const ipcRenderer = getDesktopBridge();
    if (ipcRenderer) {
      try {
        
        const startResult = await ipcRenderer.invoke('send-file-start', {
          name: file.name,
          size: file.size,
          type: file.type
        });
        if (startResult?.status !== 'SUCCESS' || !startResult.transferId) {
          throw new Error(startResult?.error || 'Не удалось начать передачу файла');
        }
        transferId = startResult.transferId;

        const CHUNK_SIZE = 64 * 1024;
        let offset = 0;
        
        while (offset < file.size) {
            const chunk = file.slice(offset, offset + CHUNK_SIZE);
            const buffer = await chunk.arrayBuffer();
            const base64Chunk = encodeBase64(new Uint8Array(buffer));
            
            const chunkResult = await ipcRenderer.invoke('send-file-chunk-data', {
                transferId,
                offset: offset,
                size: file.size,
                data: base64Chunk
            });
            if (chunkResult?.status !== 'SUCCESS') {
              throw new Error(chunkResult?.error || 'Не удалось передать часть файла');
            }
            
            offset += CHUNK_SIZE;
            const progress = Math.min(100, Math.round((offset / file.size) * 100));
            setSendingFile({ name: file.name, progress, size: file.size });
        }
        
        const endResult = await ipcRenderer.invoke('send-file-end', { transferId });
        if (endResult?.status !== 'SUCCESS') {
          throw new Error(endResult?.error || 'Телефон не подтвердил завершение передачи');
        }
        
        if (onAddLog) {
          onAddLog('FILE_TRANSFER', `Файл ${file.name} передан мобильному устройству (64KB chunks)`, 'success');
        }
        setTimeout(() => setSendingFile(null), 2000);
      } catch (err) {
          if (transferId) {
            try {
              await ipcRenderer.invoke('send-file-cancel', { transferId });
            } catch (_) {}
          }
          if (onAddLog) onAddLog('FILE_TRANSFER', `Ошибка передачи файла: ${err}`, 'error');
          setSendingFile(null);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleProcessFile(e.target.files[0]);
    }
  };

  return (
    <div className={`p-5 rounded-2xl border transition-all duration-300 ${
      theme === 'light'
        ? 'bg-white/80 border-slate-200/80 shadow-sm'
        : 'bg-[#0B0F17]/80 border-white/10 backdrop-blur-xl shadow-2xl'
    }`}>
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <FolderOpen className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-wide uppercase text-emerald-400">
              {isRu ? 'Обмен файлами' : 'File exchange'}
            </h3>
          </div>
        </div>

        <button
          onClick={() => handleOpenFolder()}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-2 transition-all cursor-pointer ${
            theme === 'light'
              ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10'
          }`}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          {isRu ? 'Открыть папку' : 'Open folder'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl p-6 text-center flex flex-col items-center justify-center cursor-pointer transition-all duration-300 min-h-[160px] ${
            isDragging
              ? 'border-emerald-500 bg-emerald-500/10 scale-[1.01]'
              : theme === 'light'
                ? 'border-slate-300 hover:border-emerald-500 bg-slate-50/50 hover:bg-emerald-50/30'
                : 'border-white/15 hover:border-emerald-500/60 bg-white/[0.02] hover:bg-white/[0.04]'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="p-3 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-3">
            <Upload className="w-6 h-6 animate-bounce" />
          </div>

          <p className="text-xs font-semibold mb-1 text-slate-200">
            {isRu ? 'ЗОНА «ДРОП»: Перетащите файл сюда' : 'DROP ZONE: Drag & drop file here'}
          </p>
          <p className="text-[11px] text-slate-400 max-w-xs">
            {isRu ? 'нажмите для выбора файла и отправки на телефон' : 'or click to browse file to send to mobile'}
          </p>

          {sendingFile && (
            <div className="absolute inset-0 bg-[#0B0F17]/95 rounded-xl p-4 flex flex-col justify-center items-center z-10">
              <div className="flex items-center gap-2 text-emerald-400 mb-2 text-xs font-semibold">
                <RefreshCw className="w-4 h-4 animate-spin" />
                {sendingFile.progress === 100
                  ? (isRu ? 'Файл отправлен!' : 'File Sent!')
                  : (isRu ? 'Отправка чанков (64 KB)...' : 'Sending Chunks (64 KB)...')}
              </div>
              <p className="text-xs text-slate-300 mb-2 truncate max-w-[220px]">
                {sendingFile.name} ({formatSize(sendingFile.size)})
              </p>
              <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full transition-all duration-200"
                  style={{ width: `${sendingFile.progress}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-400 mt-1">{sendingFile.progress}%</span>
            </div>
          )}
        </div>

        <div className={`border rounded-xl p-4 flex flex-col justify-between ${
          theme === 'light'
            ? 'border-slate-200 bg-slate-50/50'
            : 'border-white/10 bg-white/[0.02]'
        }`}>
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                <FileDown className="w-4 h-4" />
                {isRu ? 'ПОЛУЧЕНИЕ (Received Files)' : 'Received Files'}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
                {receivedFiles.length} {isRu ? 'файлов' : 'files'}
              </span>
            </div>

            <div className="space-y-2 max-h-[120px] overflow-y-auto pr-1">
              {receivedFiles.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6 italic">
                  {isRu ? 'Ожидание файлов со смартфона...' : 'Waiting for files from mobile device...'}
                </p>
              ) : (
                receivedFiles.map((file) => (
                  <div
                    key={file.id}
                    className={`p-2.5 rounded-lg border flex items-center justify-between transition-all ${
                      theme === 'light'
                        ? 'bg-white border-slate-200 hover:border-slate-300'
                        : 'bg-white/5 border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      {getFileIcon(file.name)}
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate text-slate-200" title={file.name}>
                          {file.name}
                        </p>
                        <p className="text-[10px] text-slate-400 font-mono flex items-center gap-2">
                          <span>{formatSize(file.size)}</span>
                          <span>•</span>
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" />
                            {file.timestamp}
                          </span>
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleOpenFolder(file.path)}
                      title={isRu ? 'Показать в папке' : 'Show in Folder'}
                      className="p-1.5 rounded-md hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
