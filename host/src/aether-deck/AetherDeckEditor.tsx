import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Copy, Download, GripVertical, ImagePlus, Layers3, Plus, Save, Settings2, Trash2, Upload } from 'lucide-react';
import { deckApi } from './api';
import { compatibleProviders, CONTROL_CHOICES, folderTargets, friendlyFieldsFor, isActionCompatible, loadDeveloperMode, saveDeveloperMode, STATUS_OPTIONS } from './editorModel';
import { SimpleActionFields } from './SimpleActionFields';
import { AetherDeckTutorial } from './AetherDeckTutorial';
import { gridCellFromPointer } from './gridModel';
import type { ControlType, Deck, DeckAction, DeckControl, DeckDocument, DeckPage, ProviderDescription } from './types';
import './aetherDeck.css';

const createId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const clone = <T,>(value: T): T => structuredClone(value);
const BUILTIN_ICONS = [
  { name: 'sparkles', label: 'Искра', glyph: '✦' }, { name: 'play', label: 'Воспроизведение', glyph: '▶' },
  { name: 'volume', label: 'Громкость', glyph: '◕' }, { name: 'power', label: 'Питание', glyph: '⏻' },
  { name: 'folder', label: 'Папка', glyph: '▰' }, { name: 'obs', label: 'OBS', glyph: '◉' },
  { name: 'terminal', label: 'Терминал', glyph: '⌘' }
];

function makeAction(provider?: ProviderDescription): DeckAction {
  const action = provider?.actions[0];
  return { id: createId('action'), providerId: provider?.id || 'aether', type: action?.type || 'media.playPause', enabled: true, parameters: {}, delayMs: 0, repeat: 1, condition: null, continueOnError: false };
}

function firstFree(page: DeckPage, columnSpan = 1, rowSpan = 1, ignoreId?: string) {
  for (let row = 0; row < 1000; row += 1) {
    for (let column = 0; column <= page.columns - columnSpan; column += 1) {
      const candidate = { column, row, columnSpan, rowSpan };
      const overlaps = page.controls.some(control => control.id !== ignoreId && candidate.column < control.column + control.columnSpan && candidate.column + candidate.columnSpan > control.column && candidate.row < control.row + control.rowSpan && candidate.row + candidate.rowSpan > control.row);
      if (!overlaps) return { column, row };
    }
  }
  return { column: 0, row: page.controls.length };
}

function makeControl(type: ControlType, page: DeckPage, providers: ProviderDescription[]): DeckControl {
  const placement = firstFree(page);
  const control: DeckControl = {
    id: createId('control'), type, label: type === 'button' ? 'Новая кнопка' : type === 'toggle' ? 'Переключатель' : type === 'slider' ? 'Ползунок' : type === 'folder' ? 'Папка' : 'Индикатор',
    enabled: true, ...placement, columnSpan: 1, rowSpan: 1, icon: { kind: 'builtin', name: 'sparkles' }, background: '#17151f', foreground: '#ffffff', stateBinding: null,
    actions: type === 'folder' || type === 'status' ? [] : [makeAction(providers[0])]
  };
  if (type === 'toggle') control.actionsB = [makeAction(providers[0])];
  if (type === 'slider') Object.assign(control, { minimum: 0, maximum: 100, step: 1 });
  if (type === 'folder') control.targetPageId = undefined;
  if (type === 'status') control.stateBinding = 'audio.volume';
  return control;
}

export function AetherDeckEditor({ theme }: { theme: 'dark' | 'light' }) {
  const [document, setDocument] = useState<DeckDocument | null>(null);
  const [providers, setProviders] = useState<ProviderDescription[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState('');
  const [selectedPageId, setSelectedPageId] = useState('');
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [actionBranch, setActionBranch] = useState<'A' | 'B'>('A');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('Загрузка…');
  const [obsUrl, setObsUrl] = useState('ws://127.0.0.1:4455');
  const [obsPassword, setObsPassword] = useState('');
  const [obsConnected, setObsConnected] = useState(false);
  const [developerMode, setDeveloperMode] = useState(() => typeof window !== 'undefined' && loadDeveloperMode(window.localStorage));
  const [controlChooserOpen, setControlChooserOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [draggedControlId, setDraggedControlId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ column: number; row: number; columnSpan: number; rowSpan: number; valid: boolean } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const history = useRef<DeckDocument[]>([]);
  const future = useRef<DeckDocument[]>([]);

  useEffect(() => {
    Promise.resolve()
      .then(() => Promise.all([deckApi.getDocument(), deckApi.getProviders(), deckApi.getObsSettings()]))
      .then(([loaded, available, obs]) => {
        setDocument(loaded); setProviders(available); setSelectedDeckId(loaded.activeDeckId); setSelectedPageId(loaded.activePageId); setObsUrl(obs.url); setObsConnected(obs.connected); setMessage('Готово');
      })
      .catch(error => setMessage(error instanceof Error ? error.message : 'Не удалось открыть редактор'));
  }, []);

  const deck = document?.decks.find(item => item.id === selectedDeckId) || document?.decks[0];
  const page = deck?.pages.find(item => item.id === selectedPageId) || deck?.pages[0];
  const control = page?.controls.find(item => item.id === selectedControlId) || null;
  const currentActions = control ? (control.type === 'toggle' && actionBranch === 'B' ? (control.actionsB || []) : control.actions) : [];
  const actionProviders = control ? compatibleProviders(providers, control.type, developerMode) : [];

  function change(mutator: (draft: DeckDocument) => void) {
    if (!document) return;
    history.current.push(clone(document));
    if (history.current.length > 60) history.current.shift();
    future.current = [];
    const draft = clone(document);
    mutator(draft);
    setDocument(draft); setDirty(true);
  }

  function undo() {
    const previous = history.current.pop(); if (!previous || !document) return;
    future.current.push(clone(document)); setDocument(previous); setDirty(true);
  }
  function redo() {
    const next = future.current.pop(); if (!next || !document) return;
    history.current.push(clone(document)); setDocument(next); setDirty(true);
  }

  function createDeck() {
    if (!document) return;
    const pageId = createId('page'); const deckId = createId('deck');
    change(draft => draft.decks.push({ id: deckId, name: `Deck ${draft.decks.length + 1}`, enabled: true, defaultPageId: pageId, autoSwitchEnabled: false, applicationRules: [], pages: [{ id: pageId, name: 'Главная', columns: 4, background: '#08090b', backgroundAsset: null, parentPageId: null, controls: [] }] }));
    setSelectedDeckId(deckId); setSelectedPageId(pageId); setSelectedControlId(null);
  }
  function deleteDeck() {
    if (!document || !deck || document.decks.length <= 1) return;
    const fallback = document.decks.find(item => item.id !== deck.id)!;
    change(draft => { draft.decks = draft.decks.filter(item => item.id !== deck.id); if (draft.activeDeckId === deck.id) { draft.activeDeckId = fallback.id; draft.activePageId = fallback.defaultPageId; } });
    setSelectedDeckId(fallback.id); setSelectedPageId(fallback.defaultPageId); setSelectedControlId(null);
  }

  function createPage() {
    if (!deck) return; const pageId = createId('page');
    change(draft => draft.decks.find(item => item.id === deck.id)!.pages.push({ id: pageId, name: `Страница ${deck.pages.length + 1}`, columns: 4, background: '#08090b', backgroundAsset: null, parentPageId: null, controls: [] }));
    setSelectedPageId(pageId); setSelectedControlId(null);
  }
  function deletePage() {
    if (!deck || !page || deck.pages.length <= 1) return;
    const fallback = deck.pages.find(item => item.id !== page.id)!;
    change(draft => {
      const targetDeck = draft.decks.find(item => item.id === deck.id)!;
      targetDeck.pages = targetDeck.pages.filter(item => item.id !== page.id);
      if (targetDeck.defaultPageId === page.id) targetDeck.defaultPageId = fallback.id;
      for (const itemDeck of draft.decks) for (const itemPage of itemDeck.pages) for (const itemControl of itemPage.controls) if (itemControl.type === 'folder' && itemControl.targetPageId === page.id) itemControl.targetPageId = fallback.id;
      if (draft.activePageId === page.id) draft.activePageId = fallback.id;
    });
    setSelectedPageId(fallback.id); setSelectedControlId(null);
  }

  function configureApplicationRule(index: number, patch: Record<string, unknown>) {
    if (!deck) return;
    change(draft => {
      const targetDeck = draft.decks.find(item => item.id === deck.id);
      const targetRule = targetDeck?.applicationRules[index];
      if (targetRule) Object.assign(targetRule, patch);
    });
  }
  function addApplicationRule() {
    if (!deck) return;
    change(draft => draft.decks.find(item => item.id === deck.id)!.applicationRules.push({ processName: '', windowTitle: '', priority: 0 }));
  }
  function removeApplicationRule(index: number) {
    if (!deck) return;
    change(draft => { const target = draft.decks.find(item => item.id === deck.id)!; target.applicationRules = target.applicationRules.filter((_, itemIndex) => itemIndex !== index); });
  }

  function addControl(type: ControlType = 'button') {
    if (!deck || !page) return; const added = makeControl(type, page, compatibleProviders(providers, type, developerMode));
    if (type === 'folder') added.targetPageId = folderTargets(deck.pages, page.id)[0]?.id;
    change(draft => draft.decks.find(item => item.id === deck.id)!.pages.find(item => item.id === page.id)!.controls.push(added));
    setSelectedControlId(added.id); setControlChooserOpen(false);
  }

  function createFolderTargetPage() {
    if (!deck || !page || !control || control.type !== 'folder') return;
    const pageId = createId('page');
    change(draft => {
      const targetDeck = draft.decks.find(item => item.id === deck.id)!;
      targetDeck.pages.push({ id: pageId, name: `Страница ${targetDeck.pages.length + 1}`, columns: 4, background: '#08090b', backgroundAsset: null, parentPageId: page.id, controls: [] });
      targetDeck.pages.find(item => item.id === page.id)!.controls.find(item => item.id === control.id)!.targetPageId = pageId;
    });
  }

  function toggleDeveloperMode(enabled: boolean) {
    setDeveloperMode(enabled);
    saveDeveloperMode(window.localStorage, enabled);
  }

  function duplicateControl() {
    if (!deck || !page || !control) return;
    const copy = clone(control); copy.id = createId('control'); copy.label = `${control.label} — копия`; Object.assign(copy, firstFree(page, copy.columnSpan, copy.rowSpan));
    copy.actions = copy.actions.map(action => ({ ...action, id: createId('action') }));
    copy.actionsB = copy.actionsB?.map(action => ({ ...action, id: createId('action') }));
    change(draft => draft.decks.find(item => item.id === deck.id)!.pages.find(item => item.id === page.id)!.controls.push(copy)); setSelectedControlId(copy.id);
  }

  function deleteControl() {
    if (!deck || !page || !control) return;
    change(draft => { const target = draft.decks.find(item => item.id === deck.id)!.pages.find(item => item.id === page.id)!; target.controls = target.controls.filter(item => item.id !== control.id); }); setSelectedControlId(null);
  }

  function updatePage(patch: Partial<DeckPage>) {
    if (!deck || !page) return;
    change(draft => Object.assign(draft.decks.find(item => item.id === deck.id)!.pages.find(item => item.id === page.id)!, patch));
  }

  function updateControl(patch: Partial<DeckControl>) {
    if (!deck || !page || !control) return;
    change(draft => Object.assign(draft.decks.find(item => item.id === deck.id)!.pages.find(item => item.id === page.id)!.controls.find(item => item.id === control.id)!, patch));
  }

  function moveControl(targetColumn: number, targetRow: number) {
    if (!page || !control || targetColumn + control.columnSpan > page.columns) return;
    const candidate = { ...control, column: targetColumn, row: targetRow };
    const collision = page.controls.some(item => item.id !== control.id && candidate.column < item.column + item.columnSpan && candidate.column + candidate.columnSpan > item.column && candidate.row < item.row + item.rowSpan && candidate.row + candidate.rowSpan > item.row);
    if (!collision) updateControl({ column: targetColumn, row: targetRow });
  }

  function updateDragPreview(clientX: number, clientY: number) {
    if (!page || !draggedControlId || !gridRef.current) return;
    const source = page.controls.find(item => item.id === draggedControlId);
    if (!source) return;
    const cell = gridCellFromPointer(gridRef.current.getBoundingClientRect(), page.columns, rows, clientX, clientY);
    const candidate = { ...source, column: cell.column, row: cell.row };
    const inside = candidate.column + candidate.columnSpan <= page.columns;
    const occupied = page.controls.some(item => item.id !== source.id && candidate.column < item.column + item.columnSpan && candidate.column + candidate.columnSpan > item.column && candidate.row < item.row + item.rowSpan && candidate.row + candidate.rowSpan > item.row);
    setDragPreview({ ...cell, columnSpan: source.columnSpan, rowSpan: source.rowSpan, valid: inside && !occupied });
  }

  function finishDrop() {
    if (deck && page && draggedControlId && dragPreview?.valid) {
      change(draft => {
        const moved = draft.decks.find(item => item.id === deck.id)!.pages.find(item => item.id === page.id)!.controls.find(item => item.id === draggedControlId)!;
        moved.column = dragPreview.column;
        moved.row = dragPreview.row;
      });
    }
    setDraggedControlId(null);
    setDragPreview(null);
  }

  function resizeControl(columnSpan: number, rowSpan: number) {
    if (!page || !control) return;
    const limitedColumnSpan = Math.max(1, Math.min(page.columns - control.column, columnSpan));
    const candidate = { ...control, columnSpan: limitedColumnSpan, rowSpan: Math.max(1, Math.min(12, rowSpan)) };
    const collision = page.controls.some(item => item.id !== control.id && candidate.column < item.column + item.columnSpan && candidate.column + candidate.columnSpan > item.column && candidate.row < item.row + item.rowSpan && candidate.row + candidate.rowSpan > item.row);
    if (!collision) updateControl({ columnSpan: candidate.columnSpan, rowSpan: candidate.rowSpan });
  }

  function updateAction(index: number, patch: Partial<DeckAction>) {
    if (!control) return; const actions = clone(currentActions); Object.assign(actions[index], patch); updateControl(control.type === 'toggle' && actionBranch === 'B' ? { actionsB: actions } : { actions });
  }
  function setCurrentActions(actions: DeckAction[]) { if (control) updateControl(control.type === 'toggle' && actionBranch === 'B' ? { actionsB: actions } : { actions }); }
  function addAction() { if (control && actionProviders[0]) setCurrentActions([...currentActions, makeAction(actionProviders[0])]); }
  function removeAction(index: number) { if (control) setCurrentActions(currentActions.filter((_, itemIndex) => itemIndex !== index)); }
  function duplicateAction(index: number) { if (control) { const actions = clone(currentActions); actions.splice(index + 1, 0, { ...clone(actions[index]), id: createId('action') }); setCurrentActions(actions); } }
  function moveAction(index: number, direction: -1 | 1) { if (!control) return; const target = index + direction; if (target < 0 || target >= currentActions.length) return; const actions = clone(currentActions); [actions[index], actions[target]] = [actions[target], actions[index]]; setCurrentActions(actions); }

  async function saveDocument() {
    if (!document) return; setMessage('Сохранение…');
    try { const saved = await deckApi.saveDocument(document); setDocument(saved); setDirty(false); history.current = []; future.current = []; setMessage('Изменения отправлены на телефон'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка сохранения'); }
  }
  async function exportDeck() { const result = await deckApi.exportDeck(); if (!result.canceled) setMessage(`Экспортировано: ${result.path}`); }
  async function importDeck() { const result = await deckApi.importDeck(); if (result.document) { setDocument(result.document); setSelectedDeckId(result.document.activeDeckId); setSelectedPageId(result.document.activePageId); setSelectedControlId(null); setDirty(false); setMessage('Deck импортирован'); } }
  async function selectIcon() { const result = await deckApi.selectAsset(); if (result.asset) updateControl({ icon: { kind: 'asset', ...result.asset } }); }
  async function saveObsSettings() { try { const result = await deckApi.setObsSettings({ url: obsUrl, password: obsPassword }); setObsConnected(result.connected); setObsPassword(''); setMessage('OBS подключён'); } catch (error) { setObsConnected(false); setMessage(error instanceof Error ? error.message : 'Не удалось подключить OBS'); } }

  const rows = useMemo(() => Math.max(5, ...(page?.controls.map(item => item.row + item.rowSpan) || [5])), [page]);
  if (!document || !deck || !page) return <div className="liquid-glass rounded-3xl p-10 text-neutral-400">{message}</div>;
  const folderPages = folderTargets<DeckPage>(deck.pages, page.id);

  return (
    <section className="aether-deck-shell liquid-glass" data-theme={theme}>
      <aside className="aether-deck-panel aether-deck-sidebar p-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[.18em] text-violet-400">Коллекция</p><h2 className="text-lg font-semibold">Deck и страницы</h2></div><button onClick={createDeck} title="Создать новый Deck" className="p-2 rounded-lg bg-white/5 hover:bg-white/10"><Plus size={16}/></button></div>
          <div className="space-y-2">{document.decks.map(item => <button key={item.id} onClick={() => { setSelectedDeckId(item.id); setSelectedPageId(item.defaultPageId); setSelectedControlId(null); }} className={`w-full text-left px-3 py-2 rounded-xl ${item.id === deck.id ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30' : 'text-neutral-400 hover:bg-white/5'}`}><Layers3 size={14} className="inline mr-2"/>{item.name}</button>)}</div>
          <div className="border-t border-white/10 pt-4 space-y-2"><div className="flex gap-1"><input aria-label="Название Deck" value={deck.name} onChange={event => change(draft => { draft.decks.find(item => item.id === deck.id)!.name = event.target.value; })} className="min-w-0 flex-1 bg-black/20 border border-white/10 rounded-lg p-2 text-xs"/><button onClick={deleteDeck} disabled={document.decks.length <= 1} title="Удалить Deck" className="p-2 text-red-400 disabled:opacity-25"><Trash2 size={14}/></button></div><div className="flex justify-between items-center mb-2"><span className="text-xs uppercase tracking-wider text-neutral-500">Страницы</span><div><button onClick={createPage} title="Добавить страницу" className="p-1.5 rounded-lg hover:bg-white/10"><Plus size={14}/></button><button onClick={deletePage} disabled={deck.pages.length <= 1} title="Удалить страницу" className="p-1.5 rounded-lg text-red-400 disabled:opacity-25"><Trash2 size={14}/></button></div></div>{deck.pages.map(item => <button key={item.id} onClick={() => { setSelectedPageId(item.id); setSelectedControlId(null); }} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${item.id === page.id ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-200'}`}>{item.name}</button>)}</div>
          {developerMode && <div className="border-t border-white/10 pt-4 space-y-2"><label className="flex items-center justify-between text-xs text-neutral-400">Автопрофиль<input type="checkbox" checked={deck.autoSwitchEnabled} onChange={event => change(draft => { draft.decks.find(item => item.id === deck.id)!.autoSwitchEnabled = event.target.checked; })}/></label><div className="flex justify-between items-center"><span className="text-[10px] uppercase tracking-wider text-neutral-500">Приложения</span><button onClick={addApplicationRule} className="p-1 rounded hover:bg-white/10"><Plus size={12}/></button></div>{deck.applicationRules.map((rule, index) => <div key={index} className="rounded-lg bg-black/20 border border-white/5 p-2 space-y-1"><input value={String(rule.processName || '')} onChange={event => configureApplicationRule(index,{processName:event.target.value})} placeholder="obs64.exe" className="w-full bg-transparent text-xs outline-none border-b border-white/10"/><input value={String(rule.windowTitle || '')} onChange={event => configureApplicationRule(index,{windowTitle:event.target.value})} placeholder="Заголовок окна (необязательно)" className="w-full bg-transparent text-[10px] outline-none border-b border-white/10"/><div className="flex gap-1"><input type="number" value={Number(rule.priority || 0)} onChange={event => configureApplicationRule(index,{priority:Number(event.target.value)})} className="w-full bg-transparent text-[10px] outline-none"/><button onClick={() => removeApplicationRule(index)} className="text-red-400"><Trash2 size={11}/></button></div></div>)}</div>}
          {developerMode && <div className="border-t border-white/10 pt-4 space-y-2"><div className="flex items-center justify-between"><span className="text-[10px] uppercase tracking-wider text-neutral-500">OBS WebSocket</span><span className={`w-2 h-2 rounded-full ${obsConnected ? 'bg-emerald-400' : 'bg-neutral-600'}`}/></div><input value={obsUrl} onChange={event => setObsUrl(event.target.value)} className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-[10px]"/><input type="password" value={obsPassword} onChange={event => setObsPassword(event.target.value)} placeholder="Пароль OBS" className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-[10px]"/><button onClick={saveObsSettings} className="w-full p-2 rounded-lg bg-white/5 text-xs hover:bg-white/10">Подключить OBS</button></div>}
          <details className="border-t border-white/10 pt-3"><summary className="cursor-pointer text-xs text-neutral-500">Импорт и экспорт</summary><div className="space-y-2 mt-2"><button onClick={importDeck} className="w-full flex gap-2 items-center px-3 py-2 rounded-xl bg-white/5 text-sm hover:bg-white/10"><Upload size={15}/>Импорт .aetherdeck</button><button onClick={exportDeck} className="w-full flex gap-2 items-center px-3 py-2 rounded-xl bg-white/5 text-sm hover:bg-white/10"><Download size={15}/>Экспорт</button></div></details>
        </div>
        <div className="aether-deck-sidebar-footer border-t border-white/10 pt-3 space-y-2">
          <button onClick={() => setTutorialOpen(true)} className="w-full flex gap-2 items-center px-3 py-2 rounded-xl bg-violet-500/10 text-violet-200 hover:bg-violet-500/20"><BookOpen size={15}/>Обучение</button>
          <label className="flex items-center justify-between gap-3 px-2 py-2 text-xs text-neutral-400" title="Показывает технические настройки, условия и точные параметры"><span className="flex items-center gap-2"><Settings2 size={14}/>Режим разработчика</span><input type="checkbox" checked={developerMode} onChange={event => toggleDeveloperMode(event.target.checked)}/></label>
        </div>
      </aside>

      <main className="p-5 min-w-0">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-5"><div><input value={page.name} onChange={event => updatePage({ name: event.target.value })} className="bg-transparent text-xl font-semibold outline-none border-b border-transparent focus:border-violet-500"/><p className="text-xs text-neutral-500 mt-1">Страница панели · изменения появятся на телефоне после сохранения</p></div><div className="flex items-center gap-2"><button onClick={undo} disabled={!history.current.length} className="px-3 py-2 text-xs rounded-lg bg-white/5 disabled:opacity-30">Назад</button><button onClick={redo} disabled={!future.current.length} className="px-3 py-2 text-xs rounded-lg bg-white/5 disabled:opacity-30">Вперёд</button><button onClick={saveDocument} disabled={!dirty} className="px-4 py-2 flex gap-2 items-center text-sm rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40"><Save size={15}/>Сохранить</button></div></div>
        <div className="flex flex-wrap items-center gap-2 mb-4"><button onClick={() => setControlChooserOpen(value => !value)} className="px-4 py-2 flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm"><Plus size={15}/>Добавить элемент</button>{developerMode && <label className="ml-auto flex items-center gap-2 text-xs text-neutral-400">Колонки <input aria-label="columns 3 8" type="range" min="3" max="8" value={page.columns} onChange={event => { const columns = Number(event.target.value); if (page.controls.every(item => item.column + item.columnSpan <= columns)) updatePage({ columns }); }} /></label>}</div>
        {controlChooserOpen && <div className="aether-deck-control-chooser mb-4">{CONTROL_CHOICES.map(choice => <button key={choice.type} onClick={() => addControl(choice.type)} className="aether-deck-choice"><strong>{choice.label}</strong><span>{choice.description}</span></button>)}</div>}
        <div ref={gridRef} className="aether-deck-grid rounded-2xl border border-white/10 p-3" style={{ gridTemplateColumns: `repeat(${page.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, 88px)`, background: page.background }} onDragOver={event => { event.preventDefault(); updateDragPreview(event.clientX, event.clientY); }} onDrop={event => { event.preventDefault(); finishDrop(); }}>
          {page.controls.length === 0 && <div className="aether-deck-empty" style={{ gridColumn: `1 / span ${page.columns}`, gridRow: '1 / span 3' }}><Layers3 size={30}/><h3>Эта страница пока пустая</h3><p>Добавьте первую кнопку или другой элемент панели.</p><button onClick={() => setControlChooserOpen(true)}><Plus size={15}/>Добавить первый элемент</button></div>}
          {dragPreview && <div className={`aether-deck-drop-preview ${dragPreview.valid ? 'valid' : 'invalid'}`} style={{ gridColumn: `${dragPreview.column + 1} / span ${dragPreview.columnSpan}`, gridRow: `${dragPreview.row + 1} / span ${dragPreview.rowSpan}` }}/>}          
          {page.controls.map(item => <button key={item.id} draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/aether-control', item.id); setDraggedControlId(item.id); setSelectedControlId(item.id); }} onDragEnd={() => { setDraggedControlId(null); setDragPreview(null); }} onClick={() => setSelectedControlId(item.id)} className={`aether-deck-control ${item.id === selectedControlId ? 'selected' : ''} ${item.id === draggedControlId ? 'dragging' : ''} ${item.enabled ? '' : 'opacity-40'}`} style={{ gridColumn: `${item.column + 1} / span ${item.columnSpan}`, gridRow: `${item.row + 1} / span ${item.rowSpan}`, background: item.background, color: item.foreground }}><GripVertical size={14} className="absolute top-2 left-2 opacity-30"/><span className="text-xl opacity-80">{item.icon?.kind === 'builtin' ? BUILTIN_ICONS.find(icon => icon.name === item.icon?.name)?.glyph : '▧'}</span><span className="px-3 text-sm font-semibold line-clamp-2">{item.label}</span><span className="absolute bottom-2 left-3 text-[10px] uppercase tracking-wider opacity-40">{CONTROL_CHOICES.find(choice => choice.type === item.type)?.label || item.type}</span><span className="aether-deck-resize">◢</span></button>)}
        </div>
        <p className="mt-3 text-xs text-neutral-500">{message}{dirty ? ' · Есть несохранённые изменения' : ''}</p>
      </main>

      <aside className="aether-deck-panel aether-deck-inspector p-4 overflow-y-auto max-h-[780px]">
        {!control ? <div className="h-full flex flex-col items-center justify-center text-center text-neutral-500"><Layers3 size={28} className="mb-3 opacity-50"/><p className="text-sm">Выберите элемент сетки</p><p className="text-xs mt-1">Здесь появятся свойства и макросы</p></div> : <div className="space-y-5">
          <div className="flex justify-between items-center"><div><p className="text-xs uppercase tracking-wider text-violet-400">Элемент</p><h3 className="font-semibold">{control.label}</h3></div><div className="flex"><button onClick={duplicateControl} title="Дублировать" className="p-2 hover:bg-white/10 rounded-lg"><Copy size={15}/></button><button onClick={deleteControl} title="Удалить" className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg"><Trash2 size={15}/></button></div></div>
          <label className="block text-xs text-neutral-400">Название<input value={control.label} onChange={event => updateControl({ label: event.target.value })} className="mt-1 w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-neutral-100 outline-none focus:border-violet-500"/></label>
          {developerMode && <div className="grid grid-cols-2 gap-2"><label className="text-xs text-neutral-400">Ширина<input aria-label="resize width" type="number" min="1" max={page.columns - control.column} value={control.columnSpan} onChange={event => resizeControl(Number(event.target.value), control.rowSpan)} className="mt-1 w-full bg-black/30 border border-white/10 rounded-lg p-2"/></label><label className="text-xs text-neutral-400">Высота<input aria-label="resize height" type="number" min="1" max="12" value={control.rowSpan} onChange={event => resizeControl(control.columnSpan, Number(event.target.value))} className="mt-1 w-full bg-black/30 border border-white/10 rounded-lg p-2"/></label></div>}
          <div className="grid grid-cols-2 gap-2"><label className="text-xs text-neutral-400">Фон<input type="color" value={control.background} onChange={event => updateControl({ background: event.target.value })} className="mt-1 w-full h-9 bg-transparent"/></label><label className="text-xs text-neutral-400">Текст<input type="color" value={control.foreground} onChange={event => updateControl({ foreground: event.target.value })} className="mt-1 w-full h-9 bg-transparent"/></label></div>
          <label className="block text-xs text-neutral-400">Встроенная иконка<select value={control.icon?.kind === 'builtin' ? control.icon.name : ''} onChange={event => updateControl({ icon: { kind: 'builtin', name: event.target.value } })} className="mt-1 w-full bg-neutral-900 border border-white/10 rounded-lg p-2">{BUILTIN_ICONS.map(icon => <option key={icon.name} value={icon.name}>{icon.glyph} {icon.label}</option>)}</select></label>
          <button onClick={selectIcon} className="w-full flex justify-center gap-2 items-center px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm"><ImagePlus size={15}/>PNG, JPG, GIF или WebP</button>
          {control.type === 'status' && <label className="block text-xs text-neutral-300">Какое состояние показывать?<select value={control.stateBinding || ''} onChange={event => updateControl({ stateBinding: event.target.value || null })} className="aether-deck-input mt-1">{STATUS_OPTIONS.map(option => <option key={option.binding} value={option.binding}>{option.label}</option>)}</select><span className="aether-deck-field-help">{STATUS_OPTIONS.find(option => option.binding === control.stateBinding)?.description || 'Значение будет обновляться автоматически.'}</span></label>}
          {developerMode && control.type !== 'status' && <label className="block text-xs text-neutral-400">Динамическое состояние<input value={control.stateBinding || ''} placeholder="media.track" onChange={event => updateControl({ stateBinding: event.target.value || null })} className="mt-1 w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-neutral-100"/></label>}
          {developerMode && <label className="flex items-center justify-between text-sm">Элемент активен<input type="checkbox" checked={control.enabled} onChange={event => updateControl({ enabled: event.target.checked })}/></label>}
          {control.type === 'folder' && <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3"><p className="text-sm font-medium">Переход на другую страницу</p><p className="aether-deck-field-help mb-2">На телефоне Папка откроет выбранную страницу. Вернуться можно кнопкой «Назад».</p>{folderPages.length > 0 ? <label className="block text-xs text-neutral-300">Страница назначения<select value={control.targetPageId || ''} onChange={event => updateControl({ targetPageId: event.target.value })} className="aether-deck-input mt-1"><option value="">Выберите страницу</option>{folderPages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <div><p className="text-xs text-amber-200">Сначала нужна ещё одна страница.</p><button onClick={createFolderTargetPage} className="mt-2 px-3 py-2 rounded-lg bg-violet-600 text-xs">Создать страницу для Папки</button></div>}</div>}
          {control.type === 'slider' && <div className="grid grid-cols-3 gap-2">{([['minimum','Минимум'],['maximum','Максимум'],['step','Шаг']] as const).map(([field,label]) => <label key={field} className="text-[10px] text-neutral-500">{label}<input type="number" value={control[field]} onChange={event => updateControl({ [field]: Number(event.target.value) })} className="mt-1 w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs"/></label>)}</div>}
          {control.type !== 'folder' && control.type !== 'status' && <div className="border-t border-white/10 pt-4">
            <div className="flex justify-between items-center mb-3"><div><p className="text-xs uppercase tracking-wider text-neutral-500">{currentActions.length > 1 ? 'Макрос' : 'Действие'}</p><p className="text-sm font-medium">{currentActions.length > 1 ? 'Шаги выполняются по порядку' : 'Что произойдёт при нажатии'}</p></div><button onClick={addAction} title="Добавить шаг макроса" className="p-2 bg-violet-500/15 text-violet-300 rounded-lg"><Plus size={15}/></button></div>
            {control.type === 'toggle' && <div className="grid grid-cols-2 gap-1 mb-3 rounded-lg bg-black/20 p-1"><button onClick={() => setActionBranch('A')} className={`py-1 text-xs rounded ${actionBranch === 'A' ? 'bg-violet-500/25 text-violet-200' : 'text-neutral-500'}`}>При включении</button><button onClick={() => setActionBranch('B')} className={`py-1 text-xs rounded ${actionBranch === 'B' ? 'bg-violet-500/25 text-violet-200' : 'text-neutral-500'}`}>При выключении</button></div>}
            <div className="space-y-3">{currentActions.map((action, index) => {
              const compatible = isActionCompatible(providers, action, control.type);
              const selectedProvider = actionProviders.find(item => item.id === action.providerId) || providers.find(item => item.id === action.providerId) || actionProviders[0];
              const selectableActions = actionProviders.find(item => item.id === action.providerId)?.actions || [];
              return <div key={action.id} className="rounded-xl border border-white/10 p-3 bg-black/20 space-y-2">
                <div className="flex items-center justify-between"><span className="text-xs text-neutral-500">{currentActions.length > 1 ? `Шаг ${index + 1}` : 'Настройка действия'}</span><div className="flex gap-1">{developerMode && <><button onClick={() => duplicateAction(index)} title="Дублировать шаг" className="p-1"><Copy size={12}/></button><button onClick={() => moveAction(index,-1)} title="Переместить выше" className="px-2 text-xs">↑</button><button onClick={() => moveAction(index,1)} title="Переместить ниже" className="px-2 text-xs">↓</button></>} {currentActions.length > 1 && <button onClick={() => removeAction(index)} title="Удалить шаг" className="p-1 text-red-400"><Trash2 size={13}/></button>}</div></div>
                {!compatible && <p className="aether-deck-compatibility-warning">Это действие сохранено из старой конфигурации, но не подходит выбранному типу элемента. Выберите совместимое действие ниже.</p>}
                <label className="block text-xs text-neutral-400">Категория<select value={action.providerId} onChange={event => { const nextProvider = actionProviders.find(item => item.id === event.target.value); updateAction(index,{ providerId:event.target.value,type:nextProvider?.actions[0]?.type || '',parameters:{} }); }} className="aether-deck-input mt-1">{!actionProviders.some(item => item.id === action.providerId) && <option value={action.providerId}>{selectedProvider?.name || action.providerId} — несовместимо</option>}{actionProviders.map(item => <option key={item.id} value={item.id}>{item.name}{item.available ? '' : ' — недоступен'}</option>)}</select></label>
                <label className="block text-xs text-neutral-400">Действие<select value={action.type} onChange={event => updateAction(index,{type:event.target.value,parameters:{}})} className="aether-deck-input mt-1">{!selectableActions.some(item => item.type === action.type) && <option value={action.type}>{selectedProvider?.actions.find(item => item.type === action.type)?.name || action.type} — несовместимо</option>}{selectableActions.map(item => <option key={item.type} value={item.type}>{item.name}</option>)}</select></label>
                {!selectedProvider?.available && <p className="text-xs text-amber-200">Эта интеграция сейчас недоступна. Проверьте её подключение в режиме разработчика.</p>}
                <SimpleActionFields action={action} fields={friendlyFieldsFor(action.type)} decks={document.decks} onChange={parameters => updateAction(index,{parameters})}/>
                {developerMode && <div className="space-y-2 border-t border-white/10 pt-2"><label className="block text-[10px] text-neutral-500">Параметры JSON<textarea key={`${action.id}-${JSON.stringify(action.parameters)}`} defaultValue={JSON.stringify(action.parameters)} onBlur={event => { try { updateAction(index,{parameters:JSON.parse(event.target.value)}); } catch { setMessage('Параметры действия должны быть JSON-объектом'); } }} className="mt-1 w-full min-h-16 bg-black/30 border border-white/10 rounded-lg p-2 font-mono text-[10px]"/></label><label className="block text-[10px] text-neutral-500">Условие JSON<textarea key={`${action.id}-condition-${JSON.stringify(action.condition)}`} defaultValue={action.condition ? JSON.stringify(action.condition) : ''} onBlur={event => { try { updateAction(index,{condition:event.target.value.trim() ? JSON.parse(event.target.value) : null}); } catch { setMessage('Условие должно быть JSON-объектом'); } }} className="mt-1 w-full min-h-12 bg-black/30 border border-white/10 rounded-lg p-2 font-mono"/></label><div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-neutral-500">Задержка, мс<input type="number" min="0" value={action.delayMs} onChange={event => updateAction(index,{delayMs:Number(event.target.value)})} className="mt-1 w-full bg-black/30 border border-white/10 rounded p-1"/></label><label className="text-[10px] text-neutral-500">Повторы<input type="number" min="1" max="100" value={action.repeat} onChange={event => updateAction(index,{repeat:Number(event.target.value)})} className="mt-1 w-full bg-black/30 border border-white/10 rounded p-1"/></label></div><div className="flex justify-between text-[10px] text-neutral-400"><label>Включено <input type="checkbox" checked={action.enabled} onChange={event => updateAction(index,{enabled:event.target.checked})}/></label><label>Продолжить при ошибке <input type="checkbox" checked={action.continueOnError} onChange={event => updateAction(index,{continueOnError:event.target.checked})}/></label></div></div>}
              </div>;
            })}</div>
          </div>}
        </div>}
      </aside>
      <AetherDeckTutorial open={tutorialOpen} developerMode={developerMode} onClose={() => setTutorialOpen(false)}/>
    </section>
  );
}
