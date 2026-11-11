import React from 'react';
import type { Deck, DeckAction } from './types';
import type { FriendlyField } from './editorModel';
import { deckApi } from './api';

interface SimpleActionFieldsProps {
  action: DeckAction;
  fields: FriendlyField[] | null;
  decks: Deck[];
  onChange: (parameters: Record<string, unknown>) => void;
}

export function SimpleActionFields({ action, fields, decks, onChange }: SimpleActionFieldsProps) {
  if (action.type === 'system.launchApplication') {
    const update = (key: string, value: unknown) => onChange({ ...action.parameters, [key]: value });
    const argumentsValue = Array.isArray(action.parameters.arguments) ? (action.parameters.arguments as unknown[]).join(', ') : '';
    const selectApplication = async () => {
      const result = await deckApi.selectApplication();
      if (!result.canceled && result.path) update('path', result.path);
    };
    return <div className="space-y-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-2">
      <p className="text-[10px] text-sky-300">Выберите любое приложение или вставьте путь вручную.</p>
      <label className="block text-xs text-neutral-400">Приложение<input value={String(action.parameters.path || '')} onChange={event => update('path', event.target.value)} className="aether-deck-input mt-1" placeholder="C:\Program Files\App\app.exe"/></label>
      <button type="button" onClick={selectApplication} className="w-full rounded-lg bg-sky-500/15 px-3 py-2 text-xs text-sky-200 hover:bg-sky-500/25">Выбрать приложение…</button>
      <label className="block text-xs text-neutral-400">Аргументы<input value={argumentsValue} onChange={event => update('arguments', event.target.value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 64))} className="aether-deck-input mt-1" placeholder="--profile, work"/></label>
      <label className="block text-xs text-neutral-400">Рабочая папка<input value={String(action.parameters.workingDirectory || '')} onChange={event => update('workingDirectory', event.target.value)} className="aether-deck-input mt-1" placeholder="C:\Work"/></label>
    </div>;
  }
  if (fields === null) {
    return <p className="aether-deck-hint">Для параметров этого действия включите режим разработчика.</p>;
  }
  if (fields.length === 0) return <p className="aether-deck-hint">Дополнительная настройка не требуется.</p>;

  const update = (key: string, value: unknown) => onChange({ ...action.parameters, [key]: value });
  return <div className="space-y-2">{fields.map(field => {
    if (field.type === 'boolean') {
      return <label key={field.key} className="flex items-center justify-between text-xs text-neutral-300">{field.label}<input type="checkbox" checked={action.parameters[field.key] === true} onChange={event => update(field.key, event.target.checked)}/></label>;
    }
    if (field.type === 'page') {
      const pages = decks.flatMap(deck => deck.pages.map(page => ({ id: page.id, name: `${deck.name} / ${page.name}` })));
      return <label key={field.key} className="block text-xs text-neutral-400">{field.label}<select value={String(action.parameters[field.key] || '')} onChange={event => update(field.key, event.target.value)} className="aether-deck-input mt-1"> <option value="">Выберите страницу</option>{pages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}</select></label>;
    }
    if (field.type === 'deck') {
      return <label key={field.key} className="block text-xs text-neutral-400">{field.label}<select value={String(action.parameters[field.key] || '')} onChange={event => update(field.key, event.target.value)} className="aether-deck-input mt-1"><option value="">Выберите Deck</option>{decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label>;
    }
    const value = field.type === 'keys'
      ? (Array.isArray(action.parameters[field.key]) ? (action.parameters[field.key] as unknown[]).join(', ') : '')
      : String(action.parameters[field.key] ?? '');
    return <label key={field.key} className="block text-xs text-neutral-400">{field.label}<input type={field.type === 'number' ? 'number' : 'text'} min={field.min} max={field.max} value={value} placeholder={field.placeholder} onChange={event => update(field.key, field.type === 'number' ? Number(event.target.value) : field.type === 'keys' ? event.target.value.split(',').map(item => item.trim()).filter(Boolean) : event.target.value)} className="aether-deck-input mt-1"/></label>;
  })}</div>;
}
