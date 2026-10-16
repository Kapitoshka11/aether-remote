import React, { useEffect, useState } from 'react';
import { ChevronDown, LogIn, LogOut, MonitorSmartphone, Pencil, RefreshCw, ShieldOff, UserRound } from 'lucide-react';
import { getDesktopBridge } from '../platform/desktopBridge';

type Device = { id: string; kind: 'host' | 'phone'; name: string; revokedAt: string | null; trustedHere?: boolean };
type AccountState = {
  profile?: { id: string; email: string } | null;
  busy?: boolean; persistent?: boolean; online?: boolean; unavailable?: boolean;
  message?: string | null; passwordRecovery?: boolean; devices?: Device[];
};

export function AccountPanel({ theme = 'dark' }: { theme?: 'dark' | 'light' }) {
  const [state, setState] = useState<AccountState>({});
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [revoke, setRevoke] = useState<Device | null>(null);
  const [rename, setRename] = useState<Device | null>(null);
  const [name, setName] = useState('');
  const bridge = getDesktopBridge();
  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    const listener = (_event: unknown, value: AccountState) => { if (!disposed) setState(value); };
    bridge.on('account-state', listener);
    void bridge.invoke<AccountState>('account:get-state').then(value => { if (!disposed) setState(value); }).catch(() => {
      if (!disposed) setState({ unavailable: true });
    });
    return () => { disposed = true; bridge.removeListener('account-state', listener); };
  }, [bridge]);

  async function action(action: string, extra: Record<string, string> = {}) {
    if (!bridge) { setMessage('Аккаунт доступен в приложении Aether Remote для Windows.'); return; }
    setPending(true); setMessage('');
    try {
      const result = await bridge.invoke<{ ok: boolean; message?: string }>('account:action', { action, ...extra });
      if (result.message) setMessage(result.message);
    } catch { setMessage('Не удалось выполнить действие. Попробуйте ещё раз.'); }
    finally { setPending(false); }
  }
  function submit(actionName: string) {
    const input = password;
    setPassword('');
    void action(actionName, { email, password: input });
  }
  const busy = Boolean(state.busy || pending);
  const button = `inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition disabled:opacity-40 ${theme === 'light' ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50' : 'border-white/10 bg-white/5 text-white/75 hover:bg-white/10'}`;
  const primaryButton = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-orange-600 disabled:opacity-40';
  const input = `mt-1 w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 ${theme === 'light' ? 'border-slate-200 bg-white text-slate-900' : 'border-white/10 bg-black/25 text-white'}`;
  return <section className={`rounded-xl border p-4 ${theme === 'light' ? 'bg-slate-100/70 border-slate-200 text-slate-800' : 'bg-white/5 border-white/10 text-white/90'}`}>
    <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${theme === 'light' ? 'border-orange-200 bg-orange-50' : 'border-orange-400/20 bg-orange-500/10'}`}>
        <UserRound className="h-4 w-4 text-orange-500" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold uppercase tracking-wider">Аккаунт</span>
        <span className="block truncate text-[11px] opacity-55">{state.profile?.email || 'Вход, синхронизация и доверенные устройства'}</span>
      </span>
      <ChevronDown className={`h-4 w-4 shrink-0 opacity-50 transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
    {expanded && <div className={`mt-4 space-y-4 border-t pt-4 ${theme === 'light' ? 'border-slate-200' : 'border-white/10'}`}>
      {state.unavailable && <p role="status">Не удалось открыть защищённое хранилище аккаунта. Гостевое подключение доступно по QR.</p>}
      {state.persistent === false && <p role="status">Вход сохранится только до закрытия приложения: защищённое хранилище недоступно.</p>}
      {(message || state.message) && <p role="status" className="text-sm text-sky-500">{message || state.message}</p>}
      {state.passwordRecovery ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); submit('update-password'); }}>
        <label className="block">Новый пароль<input className={input} type="password" autoComplete="new-password" value={password} minLength={8} maxLength={1024} onChange={e => setPassword(e.target.value)} required /></label>
        <button className={primaryButton} disabled={busy}>Сохранить пароль</button>
      </form> : !state.profile ? <div className="space-y-4">
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); submit('sign-in'); }}>
          <label className="block text-xs opacity-75">Почта<input className={input} type="email" autoComplete="username" value={email} maxLength={254} onChange={e => setEmail(e.target.value)} required /></label>
          <label className="block text-xs opacity-75">Пароль<input className={input} type="password" autoComplete="current-password" value={password} minLength={8} maxLength={1024} onChange={e => setPassword(e.target.value)} required /></label>
          <div className="flex flex-wrap gap-2">
            <button className={primaryButton} disabled={busy || state.unavailable}><LogIn className="h-3.5 w-3.5" />Войти</button>
            <button type="button" className={button} disabled={busy || state.unavailable} onClick={() => submit('sign-up')}>Создать аккаунт</button>
            <button type="button" className={button} disabled={busy || state.unavailable} onClick={() => void action('recover', { email })}>Восстановить пароль</button>
          </div>
        </form>
        {busy && <button className={button} onClick={() => void action('cancel')}>Отменить вход</button>}
        <p className="text-sm opacity-65">Гостевой режим работает без аккаунта. Для него отсканируйте QR-код ниже.</p>
      </div> : <>
        <p className="text-sm opacity-65">{state.online ? 'Каталог устройств синхронизирован.' : 'Облако недоступно. Ранее разрешённые телефоны могут подключаться по локальной сети.'}</p>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy} onClick={() => void action('refresh')}><RefreshCw className="h-3.5 w-3.5" />Обновить</button>
          <button className={button} disabled={busy} onClick={() => void action('sign-out')}><LogOut className="h-3.5 w-3.5" />Выйти</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(state.devices || []).map(device => <article key={device.id} className={`rounded-xl border p-3 space-y-2 min-w-0 ${theme === 'light' ? 'border-slate-200 bg-white/70' : 'border-white/10 bg-black/20'}`}>
            <div className="flex items-start gap-2"><MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" /><div className="min-w-0"><h3 className="text-sm font-semibold break-words">{device.name}</h3>
            <p className="text-[11px] opacity-55">{device.revokedAt ? 'Доступ отозван' : device.kind === 'host' ? 'Компьютер' : device.trustedHere ? 'Доверенный телефон на этом ПК' : 'Телефон — требуется подтверждение на этом ПК'}</p></div></div>
            {!device.revokedAt && <div className="flex flex-wrap gap-2">
              <button className={button} disabled={busy} onClick={() => { setRename(device); setName(device.name); }}><Pencil className="h-3.5 w-3.5" />Название</button>
              <button className={button} disabled={busy} onClick={() => setRevoke(device)}><ShieldOff className="h-3.5 w-3.5" />Отозвать</button>
            </div>}
          </article>)}
        </div>
      </>}
      {revoke && <div role="alertdialog" aria-label="Отзыв устройства" className="rounded-xl border border-orange-500 p-4 space-y-3">
        <p>Отозвать доступ устройства «{revoke.name}»? Компьютер без интернета применит отзыв при возвращении в сеть.</p>
        <button className={button} onClick={() => { void action('revoke', { id: revoke.id }); setRevoke(null); }}>Отозвать</button>{' '}
        <button className={button} onClick={() => setRevoke(null)}>Отмена</button>
      </div>}
      {rename && <form className="max-w-lg space-y-3" onSubmit={event => { event.preventDefault(); void action('rename', { id: rename.id, name }); setRename(null); }}>
        <label className="block">Название устройства<input className={input} value={name} maxLength={80} onChange={event => setName(event.target.value)} required /></label>
        <button className={button} disabled={!name.trim()}>Сохранить</button>{' '}
        <button type="button" className={button} onClick={() => setRename(null)}>Отмена</button>
      </form>}
    </div>}
  </section>;
}
