import React, { useEffect, useState } from 'react';
import { Radio, Trash2 } from 'lucide-react';
import { getDesktopBridge } from '../platform/desktopBridge';

type WakeStatus = {
  status?: string;
  detail?: string;
  bridgeEnabled?: boolean;
  relayConnected?: boolean;
  groupId?: string;
  members?: Array<{ deviceId: string; role: string }>;
  targets?: Array<{ deviceId: string; name: string }>;
};

export function WakeBridgeSettings({ language, theme }: { language: 'RU' | 'EN'; theme: 'dark' | 'light' }) {
  const [status, setStatus] = useState<WakeStatus>({ status: 'unconfigured', members: [], targets: [] });
  const [name, setName] = useState('');
  const [mac, setMac] = useState('');
  const ipc = getDesktopBridge;

  useEffect(() => {
    const bridge = ipc();
    if (!bridge) return;
    bridge.invoke('wake-bridge:get-status').then(setStatus).catch(() => {});
    const listener = (_event: unknown, value: WakeStatus) => setStatus(value);
    bridge.on('wake-bridge-status', listener);
    return () => bridge.removeListener('wake-bridge-status', listener);
  }, []);

  const toggle = async () => {
    const result = await ipc()?.invoke('wake-bridge:set-enabled', status.bridgeEnabled !== true);
    if (result?.status) setStatus(result.status);
  };
  const addTarget = async () => {
    const result = await ipc()?.invoke('wake-bridge:add-target', { name, mac });
    if (!result?.ok) return;
    setName(''); setMac('');
    setStatus(await ipc()?.invoke('wake-bridge:get-status'));
  };
  const revoke = async (deviceId: string) => {
    await ipc()?.invoke('wake-bridge:revoke-member', deviceId);
    setStatus(await ipc()?.invoke('wake-bridge:get-status'));
  };
  const light = theme === 'light';
  const configured = status.status !== 'unconfigured';

  return <div className={`p-4 rounded-xl border space-y-3 ${light ? 'bg-slate-100/70 border-slate-200' : 'bg-white/5 border-white/10'}`}>
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2"><Radio className="w-4 h-4 text-cyan-500"/>Aether Wake Bridge</div>
        <p className="text-[11px] opacity-60 mt-1">{language === 'RU' ? 'Этот ПК может включать другие компьютеры дома через интернет.' : 'This PC can wake other home computers over the internet.'}</p>
      </div>
      <button disabled={!configured} onClick={toggle} className={`relative h-6 w-11 rounded-full ${status.bridgeEnabled ? 'bg-emerald-500' : 'bg-white/20'} disabled:opacity-40`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${status.bridgeEnabled ? 'left-5' : 'left-0.5'}`}/></button>
    </div>
    {configured && <>
      <div className="text-[11px] opacity-70">Relay: {status.relayConnected ? 'онлайн' : status.status || 'ожидание'} · группа {status.groupId?.slice(0, 8)}</div>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <input value={name} onChange={event => setName(event.target.value)} placeholder={language === 'RU' ? 'Название ПК' : 'PC name'} className="bg-black/20 rounded-lg px-2 py-2 text-xs border border-white/10"/>
        <input value={mac} onChange={event => setMac(event.target.value)} placeholder="AA:BB:CC:DD:EE:FF" className="bg-black/20 rounded-lg px-2 py-2 text-xs border border-white/10 font-mono"/>
        <button onClick={addTarget} className="px-3 rounded-lg bg-cyan-500/20 text-cyan-300 text-xs">+</button>
      </div>
      {(status.targets || []).map(target => <div key={target.deviceId} className="text-[11px] flex justify-between"><span>{target.name}</span><span className="font-mono opacity-50">{target.deviceId.slice(0, 8)}</span></div>)}
      {(status.members || []).filter(member => member.role === 'phone').map(member => <div key={member.deviceId} className="flex items-center justify-between text-[11px]"><span>{language === 'RU' ? 'Телефон' : 'Phone'} · {member.deviceId.slice(0, 8)}</span><button onClick={() => revoke(member.deviceId)} aria-label="Revoke wake member"><Trash2 className="w-4 h-4 text-red-400"/></button></div>)}
    </>}
  </div>;
}
