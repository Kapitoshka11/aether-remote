import React, { useState, useEffect, useMemo } from 'react';
import { Copy, Check, KeyRound } from 'lucide-react';
import { Language, translations } from '../data/translations';
import { encodeUniversal9Code } from '../utils/hardwarePin';
import { buildPairingQrUri } from '../utils/pairingQr';
import QRCode from 'qrcode';

interface MainPairingCardProps {
  pin: string;
  ipAddress?: string;
  networkEndpoints?: Array<{ address: string; interfaceName: string }>;
  port?: number;
  language?: Language;
  theme?: 'dark' | 'light';
  tlsFingerprint?: string;
}

export const MainPairingCard: React.FC<MainPairingCardProps> = ({
  pin,
  ipAddress = '192.168.1.50',
  networkEndpoints = [],
  port = 8080,
  language = 'RU',
  theme = 'dark',
  tlsFingerprint,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const availableEndpoints = useMemo(() => [
    { address: ipAddress, interfaceName: language === 'RU' ? 'Основная сеть' : 'Primary network' },
    ...networkEndpoints,
  ].filter((endpoint, index, all) =>
    endpoint.address && all.findIndex(candidate => candidate.address === endpoint.address) === index
  ), [ipAddress, language, networkEndpoints]);
  const [selectedAddress, setSelectedAddress] = useState(ipAddress);
  const isLight = theme === 'light';
  const t = translations[language];

  const endpoint = availableEndpoints.find(candidate => candidate.address === selectedAddress) ?? availableEndpoints[0];
  const pairingAddress = endpoint?.address || ipAddress;
  const payload = encodeUniversal9Code(pairingAddress, pin);

  useEffect(() => {
    if (!availableEndpoints.some(candidate => candidate.address === selectedAddress)) {
      setSelectedAddress(ipAddress);
    }
  }, [availableEndpoints, ipAddress, selectedAddress]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(payload.code9);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  useEffect(() => {
    const qrDataUri = buildPairingQrUri(pairingAddress, port, payload.code9, tlsFingerprint);
    QRCode.toDataURL(qrDataUri, { errorCorrectionLevel: 'H', margin: 1, width: 140 }, (err, url) => {
        if (!err) setQrCodeUrl(url);
    });
  }, [pairingAddress, port, payload.code9, tlsFingerprint]);


  return (
    <div className={`${isLight ? 'liquid-glass-light-strong border-slate-200' : 'liquid-glass-strong border-white/12'} pairing-card rounded-[2rem] p-6 sm:p-8 md:p-10 relative overflow-hidden transition-all duration-300`}>
      <div className={`absolute -right-20 -bottom-20 w-80 h-80 rounded-full blur-3xl pointer-events-none ${
        isLight ? 'bg-orange-500/10' : 'bg-orange-500/10'
      }`} />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center relative z-10">
        <div className="md:col-span-8 flex flex-col items-center md:items-start text-center md:text-left gap-4">
          <div className="flex items-center gap-2">
            <KeyRound className={`w-4 h-4 ${isLight ? 'text-orange-600' : 'text-orange-400'}`} />
            <span className={`text-xs uppercase tracking-widest font-body font-bold ${
              isLight ? 'text-slate-600' : 'text-white/70'
            }`}>
              {t.pairingPinLabel}
            </span>
          </div>

          <div className="my-1">
            <div 
              onClick={handleCopyCode}
              className={`font-serif italic text-2xl sm:text-4xl md:text-5xl tracking-wide cursor-pointer hover:opacity-80 transition-all select-all ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
              title="Click to copy pairing code"
            >
              {payload.formattedCode}
            </div>
          </div>

          <p className={`text-xs max-w-md ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
            {t.pairingPinSubtext}
          </p>

          <button
            type="button"
            onClick={handleCopyCode}
            className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-body text-xs font-semibold tracking-wide transition-all cursor-pointer ${
              copiedCode
                ? 'bg-orange-500 text-white shadow-md scale-95'
                : isLight
                ? 'bg-orange-600 hover:bg-orange-700 text-white shadow-sm hover:scale-[1.02]'
                : 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-950/30 hover:scale-[1.02]'
            }`}
          >
            {copiedCode ? (
              <>
                <Check className="w-4 h-4 shrink-0" />
                <span>COPIED!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 shrink-0" />
                <span>{t.copyPairingCode}</span>
              </>
            )}
          </button>
        </div>

        <div className={`md:col-span-4 flex flex-col items-center justify-center gap-3 pt-6 md:pt-0 border-t md:border-t-0 md:border-l ${
          isLight ? 'border-slate-200' : 'border-white/10'
        }`}>
          <span className={`text-[10px] uppercase tracking-widest font-bold ${
            isLight ? 'text-slate-500' : 'text-white/60'
          }`}>
            {t.scanToPair}
          </span>

          <div className="p-3 bg-white rounded-xl shadow-lg relative group">
            <div className="absolute top-1 left-1 w-3 h-3 border-t-2 border-l-2 border-orange-500 rounded-tl" />
            <div className="absolute top-1 right-1 w-3 h-3 border-t-2 border-r-2 border-orange-500 rounded-tr" />
            <div className="absolute bottom-1 left-1 w-3 h-3 border-b-2 border-l-2 border-orange-500 rounded-bl" />
            <div className="absolute bottom-1 right-1 w-3 h-3 border-b-2 border-r-2 border-orange-500 rounded-br" />
            {qrCodeUrl ? (
              <img
                src={qrCodeUrl}
                alt="Aether Pairing QR Code"
                className="w-[110px] h-[110px] md:w-[130px] md:h-[130px] object-contain rounded-lg"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="h-[110px] w-[110px] animate-pulse rounded-lg bg-orange-100 md:h-[130px] md:w-[130px]" aria-label="QR-код создаётся" />
            )}
          </div>

          <span className={`text-[10px] font-mono tracking-wide ${
            isLight ? 'text-slate-400' : 'text-white/40'
          }`}>
            {pairingAddress}:{port}
          </span>
          {availableEndpoints.length > 1 && (
            <label className={`flex w-full max-w-[220px] flex-col gap-1 text-[10px] ${
              isLight ? 'text-slate-500' : 'text-white/50'
            }`}>
              <span>{language === 'RU' ? 'Адрес для QR (LAN/VPN)' : 'QR address (LAN/VPN)'}</span>
              <select
                value={pairingAddress}
                onChange={(event) => setSelectedAddress(event.target.value)}
                className={`w-full rounded-lg border px-2 py-1.5 text-[11px] outline-none ${
                  isLight
                    ? 'border-slate-200 bg-white text-slate-700'
                    : 'border-white/15 bg-black/30 text-white'
                }`}
              >
                {availableEndpoints.map(candidate => (
                  <option key={candidate.address} value={candidate.address}>
                    {candidate.address} — {candidate.interfaceName}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
    </div>
  );
};




