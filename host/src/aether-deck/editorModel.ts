import type { ControlType, DeckAction, ProviderDescription } from './types';

export const DEVELOPER_MODE_KEY = 'aetherDeck.developerMode';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ControlChoice {
  type: ControlType;
  label: string;
  description: string;
}

export type FriendlyFieldType = 'text' | 'number' | 'boolean' | 'keys' | 'page' | 'deck';

export interface FriendlyField {
  key: string;
  label: string;
  type: FriendlyFieldType;
  placeholder?: string;
  min?: number;
  max?: number;
}

export interface StatusChoice {
  binding: string;
  label: string;
  description: string;
  kind: 'text' | 'percent' | 'muted' | 'playing' | 'active' | 'count';
}

export const CONTROL_CHOICES: ControlChoice[] = [
  { type: 'button', label: 'Кнопка', description: 'Запускает одно действие или целый макрос.' },
  { type: 'toggle', label: 'Переключатель', description: 'Выполняет разные действия при включении и выключении.' },
  { type: 'slider', label: 'Ползунок', description: 'Плавно изменяет значение, например громкость.' },
  { type: 'folder', label: 'Папка', description: 'Открывает другую страницу вашей панели.' },
  { type: 'status', label: 'Индикатор', description: 'Показывает актуальное состояние ПК и не нажимается.' }
];

export const STATUS_OPTIONS: StatusChoice[] = [
  { binding: 'audio.volume', label: 'Общая громкость', description: 'Текущий уровень системной громкости', kind: 'percent' },
  { binding: 'audio.muted', label: 'Звук', description: 'Включён или выключен системный звук', kind: 'muted' },
  { binding: 'media.track', label: 'Текущий трек', description: 'Название воспроизводимого трека', kind: 'text' },
  { binding: 'media.artist', label: 'Исполнитель', description: 'Исполнитель текущего трека', kind: 'text' },
  { binding: 'media.playing', label: 'Воспроизведение', description: 'Воспроизведение или пауза', kind: 'playing' },
  { binding: 'obs.connected', label: 'Подключение OBS', description: 'Доступен ли OBS WebSocket', kind: 'active' },
  { binding: 'obs.streaming', label: 'OBS Streaming', description: 'Запущена ли трансляция OBS', kind: 'active' },
  { binding: 'obs.recording', label: 'Запись OBS', description: 'Запущена ли запись OBS', kind: 'active' },
  { binding: 'system.cpu', label: 'Загрузка процессора', description: 'Текущая загрузка CPU', kind: 'percent' },
  { binding: 'system.ram', label: 'Использование памяти', description: 'Текущее использование RAM', kind: 'percent' },
  { binding: 'system.connectedClients', label: 'Подключённые устройства', description: 'Количество подключённых телефонов', kind: 'count' },
  { binding: 'stream.screen', label: 'Трансляция экрана', description: 'Запущен ли показ экрана', kind: 'active' }
];

const NO_PARAMETERS = new Set([
  'media.playPause', 'media.next', 'media.previous', 'audio.volumeUp', 'audio.volumeDown', 'audio.mute',
  'power.lock', 'power.sleep', 'power.shutdown', 'power.restart', 'window.closeActive', 'stream.start', 'stream.stop',
  'audio.masterMute', 'window.minimize', 'window.maximize', 'window.restore', 'window.close', 'navigation.back',
  'obs.stream.start', 'obs.stream.stop', 'obs.stream.toggle', 'obs.record.start', 'obs.record.stop', 'obs.record.toggle',
  'obs.record.pause', 'obs.record.resume', 'obs.replay.save'
]);

const FIELD_MAP: Record<string, FriendlyField[]> = {
  'system.launchApplication': [
    { key: 'path', label: 'Приложение', type: 'text', placeholder: 'C:\\Program Files\\App\\app.exe' },
    { key: 'arguments', label: 'Аргументы запуска', type: 'keys', placeholder: '--profile, work' },
    { key: 'workingDirectory', label: 'Рабочая папка', type: 'text', placeholder: 'C:\\Work' }
  ],
  'audio.setVolume': [{ key: 'value', label: 'Громкость, %', type: 'number', min: 0, max: 100 }],
  'audio.masterVolume': [{ key: 'value', label: 'Громкость, %', type: 'number', min: 0, max: 100 }],
  'audio.outputDevice': [{ key: 'deviceId', label: 'ID устройства вывода', type: 'text' }],
  'audio.inputDevice': [{ key: 'deviceId', label: 'ID устройства ввода', type: 'text' }],
  'audio.microphoneMute': [{ key: 'muted', label: 'Выключить микрофон', type: 'boolean' }],
  'audio.applicationVolume': [
    { key: 'process', label: 'Имя процесса', type: 'text', placeholder: 'spotify.exe' },
    { key: 'value', label: 'Громкость, %', type: 'number', min: 0, max: 100 }
  ],
  'input.key': [{ key: 'key', label: 'Клавиша', type: 'text', placeholder: 'SPACE' }],
  'input.hotkey': [{ key: 'keys', label: 'Сочетание клавиш', type: 'keys', placeholder: 'CTRL + SHIFT + S' }],
  'input.sequence': [{ key: 'keys', label: 'Последовательность клавиш', type: 'keys', placeholder: 'H, E, L, L, O' }],
  'input.text': [{ key: 'text', label: 'Текст', type: 'text' }],
  'system.runProgram': [
    { key: 'path', label: 'Путь к программе', type: 'text', placeholder: 'C:\\Program Files\\App\\app.exe' },
    { key: 'arguments', label: 'Аргументы запуска', type: 'keys', placeholder: '--profile, work' }
  ],
  'system.openFile': [{ key: 'path', label: 'Путь к файлу', type: 'text' }],
  'system.openFolder': [
    { key: 'path', label: 'Путь к папке', type: 'text' },
    { key: 'reveal', label: 'Показать файл в папке', type: 'boolean' }
  ],
  'system.openUrl': [{ key: 'url', label: 'Ссылка', type: 'text', placeholder: 'https://example.com' }],
  'system.typeText': [{ key: 'text', label: 'Текст', type: 'text' }],
  'navigation.page': [{ key: 'pageId', label: 'Страница', type: 'page' }],
  'navigation.deck': [{ key: 'deckId', label: 'Deck', type: 'deck' }],
  'obs.scene.set': [{ key: 'sceneName', label: 'Название сцены', type: 'text' }],
  'obs.source.visibility': [
    { key: 'sceneName', label: 'Название сцены', type: 'text' },
    { key: 'sceneItemId', label: 'ID источника', type: 'number', min: 0 },
    { key: 'enabled', label: 'Показывать источник', type: 'boolean' }
  ],
  'obs.source.mute': [
    { key: 'inputName', label: 'Название аудиоисточника', type: 'text' },
    { key: 'muted', label: 'Выключить звук', type: 'boolean' }
  ],
  'obs.studioMode': [{ key: 'enabled', label: 'Включить Studio Mode', type: 'boolean' }],
  'obs.transition': [{ key: 'transitionName', label: 'Название перехода', type: 'text' }]
};

export function loadDeveloperMode(storage: StorageLike): boolean {
  try { return storage.getItem(DEVELOPER_MODE_KEY) === 'true'; } catch { return false; }
}

export function saveDeveloperMode(storage: StorageLike, enabled: boolean): void {
  try { storage.setItem(DEVELOPER_MODE_KEY, String(enabled)); } catch {}
}

export function friendlyFieldsFor(actionType: string): FriendlyField[] | null {
  if (NO_PARAMETERS.has(actionType)) return [];
  return FIELD_MAP[actionType] ? FIELD_MAP[actionType].map(field => ({ ...field })) : null;
}

export function statusOption(binding: string | null | undefined): StatusChoice | undefined {
  return STATUS_OPTIONS.find(option => option.binding === binding);
}

export function formatStatusValue(binding: string | null | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Нет данных';
  const kind = statusOption(binding)?.kind || 'text';
  if (kind === 'percent') return `${Math.round(Number(value) || 0)}%`;
  if (kind === 'muted') return value === true ? 'Выключен' : 'Включён';
  if (kind === 'playing') return value === true ? 'Воспроизведение' : 'Пауза';
  if (kind === 'active') return value === true ? 'Запущен' : 'Выключен';
  return String(value);
}

export function folderTargets<T extends { id: string }>(pages: T[], currentPageId: string): T[] {
  return pages.filter(page => page.id !== currentPageId);
}

export function compatibleProviders(providers: ProviderDescription[], controlType: ControlType, developerMode: boolean): ProviderDescription[] {
  return providers
    .map(provider => ({
      ...provider,
      actions: provider.actions.filter(action => action.supportedControlTypes.includes(controlType) && (developerMode || action.developerOnly !== true))
    }))
    .filter(provider => provider.actions.length > 0);
}

export function isActionCompatible(providers: ProviderDescription[], action: Pick<DeckAction, 'providerId' | 'type'>, controlType: ControlType): boolean {
  const description = providers.find(provider => provider.id === action.providerId)?.actions.find(item => item.type === action.type);
  return description?.supportedControlTypes.includes(controlType) === true;
}
