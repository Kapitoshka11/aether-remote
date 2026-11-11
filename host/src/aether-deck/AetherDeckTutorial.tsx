import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Boxes, FolderOpen, Gauge, Import, Layers3, MousePointerClick, SlidersHorizontal, Sparkles, ToggleRight, X } from 'lucide-react';

const STEPS = [
  { title: 'Что такое Aether Deck', icon: Sparkles, body: 'Это ваша персональная панель управления ПК. Вы создаёте элементы на компьютере, а затем нажимаете их на телефоне.', tip: 'Начните с нескольких часто используемых действий.' },
  { title: 'Deck, Page и Control', icon: Layers3, body: 'Deck — вся панель. Page — отдельная страница внутри неё. Control — кнопка, ползунок, папка или индикатор.', tip: 'Один Deck может содержать сколько угодно страниц.' },
  { title: 'Создаём первый Deck', icon: Boxes, body: 'Нажмите плюс рядом с заголовком «Deck и страницы». Новый Deck сразу получит главную страницу.', tip: 'Название можно изменить в поле под списком Deck.' },
  { title: 'Как добавить кнопку', icon: MousePointerClick, body: 'Нажмите «Добавить элемент», выберите «Кнопка» и укажите понятное название.', tip: 'Пустая страница сама предложит добавить первый элемент.' },
  { title: 'Как назначить действие', icon: Sparkles, body: 'Выберите кнопку, затем категорию и действие справа. Заполните только появившиеся поля и сохраните Deck.', tip: 'Если полей нет, действие уже полностью настроено.' },
  { title: 'Настраиваем Slider', icon: SlidersHorizontal, body: 'Slider плавно передаёт значение. Укажите минимум, максимум и шаг, затем назначьте действие, которое принимает число.', tip: 'Для громкости обычно используются значения от 0 до 100.' },
  { title: 'Как работает Toggle', icon: ToggleRight, body: 'Toggle хранит два состояния. Отдельно назначьте действия «При включении» и «При выключении».', tip: 'На телефоне текущее состояние отмечается ON или OFF.' },
  { title: 'Folder и страницы', icon: FolderOpen, body: 'Folder открывает выбранную страницу. Создайте вторую страницу, добавьте Folder и выберите её как назначение.', tip: 'На телефоне кнопка «Назад» вернёт на предыдущую страницу.' },
  { title: 'Status и живые значения', icon: Gauge, body: 'Индикатор ничего не запускает. Он автоматически показывает громкость, текущий трек, состояние OBS, загрузку CPU или другое выбранное значение.', tip: 'Если данные ещё не пришли, отображается «Нет данных».' },
  { title: 'Несколько Actions как макрос', icon: Boxes, body: 'Добавьте к кнопке ещё один шаг. Все действия выполнятся по порядку одним нажатием.', tip: 'Точные задержки и условия доступны в режиме разработчика.' },
  { title: 'Как панель появляется на телефоне', icon: Sparkles, body: 'Подключите телефон к ПК и нажмите «Сохранить». Aether Deck синхронизируется автоматически.', tip: 'Если телефон подключится позже, он получит последнюю сохранённую версию.' },
  { title: 'Как редактировать и перемещать элементы', icon: MousePointerClick, body: 'Выберите элемент для настройки. Перетаскивайте карточки по сетке; точный размер доступен в режиме разработчика.', tip: 'Кнопки «Назад» и «Вперёд» отменяют и возвращают изменения.' },
  { title: 'Как использовать иконки', icon: Sparkles, body: 'Выберите встроенную иконку или загрузите PNG, JPG, GIF либо WebP. Изображение передастся на телефон вместе с Deck.', tip: 'Контрастная простая иконка лучше читается на маленьком экране.' },
  { title: 'Импорт и экспорт', icon: Import, body: 'Откройте блок «Импорт и экспорт» слева. Экспорт создаёт резервную копию .aetherdeck, а импорт восстанавливает её.', tip: 'Файл включает конфигурацию и связанные пользовательские изображения.' },
  { title: 'Режим разработчика', icon: BookOpen, body: 'Он открывает точную сетку, JSON-параметры, Conditions, задержки, повторы, автопрофили и настройки OBS.', tip: 'Продвинутые возможности скрываются, но никогда не удаляются из Deck.' }
];

const ADVANCED_STEPS = [
  { title: 'Сценарии и порядок действий', icon: Boxes, body: 'Кнопка может выполнять несколько шагов подряд. Добавляйте, дублируйте и меняйте их порядок — существующие Actions останутся частью одного сценария.', tip: 'Отключённый шаг временно пропускается, но не удаляется.' },
  { title: 'Задержка', icon: SlidersHorizontal, body: 'Задержка откладывает отдельный шаг на указанное число миллисекунд. Она полезна, когда программа должна успеть запуститься перед следующим действием.', tip: '1000 мс — одна секунда. Слишком короткая задержка может запустить следующий шаг раньше готовности программы.' },
  { title: 'Условия', icon: Gauge, body: 'Условие JSON запускает шаг только при совпадении значения состояния или переменной. Например, действие можно выполнять лишь когда OBS подключён.', tip: 'Если условие записано неверно или не выполняется, шаг будет пропущен.' },
  { title: 'Повторы и ошибки', icon: ToggleRight, body: 'Повторы выполняют один шаг несколько раз. «Продолжить при ошибке» разрешает перейти к следующему шагу, даже если текущий завершился неудачно.', tip: 'Без продолжения при ошибке сценарий останавливается на первом неуспешном обязательном шаге.' },
  { title: 'Параметры JSON', icon: BookOpen, body: 'Параметры JSON открывают точную конфигурацию Action, когда обычных полей недостаточно. Это технический формат «ключ — значение».', tip: 'Неверный JSON не сохраняется. Для обычных действий удобнее использовать поля над редактором.' },
  { title: 'Динамическое состояние', icon: Gauge, body: 'State Binding связывает элемент со значением ПК. Динамические подписи могут использовать опубликованные значения вроде media.track или audio.volume.', tip: 'Если указать неизвестное имя состояния, элемент не получит актуальное значение.' },
  { title: 'Точная сетка', icon: Layers3, body: 'В режиме разработчика можно точно менять количество колонок, ширину и высоту элемента. Обычное перемещение мышью доступно всегда.', tip: 'Размер нельзя применить, если новый прямоугольник пересекает соседний элемент.' },
];

interface AetherDeckTutorialProps {
  open: boolean;
  developerMode: boolean;
  onClose: () => void;
}

export function AetherDeckTutorial({ open, developerMode, onClose }: AetherDeckTutorialProps) {
  const [stepIndex, setStepIndex] = useState(0);
  useEffect(() => { if (open) setStepIndex(0); }, [open]);
  if (!open) return null;
  const steps = developerMode ? [...STEPS, ...ADVANCED_STEPS] : STEPS;
  const step = steps[stepIndex];
  const Icon = step.icon;
  return <div className="aether-deck-tutorial-backdrop" role="dialog" aria-modal="true" aria-label="Как пользоваться Aether Deck">
    <div className="aether-deck-tutorial">
      <div className="aether-deck-tutorial-header"><div><span>Обучение</span><strong>{stepIndex + 1} / {steps.length}</strong></div><button onClick={onClose} title="Закрыть"><X size={18}/></button></div>
      <div className="aether-deck-tutorial-progress"><span style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}/></div>
      <div className="aether-deck-tutorial-card"><div className="aether-deck-tutorial-icon"><Icon size={34}/></div><p className="aether-deck-tutorial-kicker">{stepIndex >= STEPS.length ? 'Режим разработчика' : stepIndex >= 9 ? 'Продвинутые возможности' : 'Основы'}</p><h2>{step.title}</h2><p>{step.body}</p><div className="aether-deck-tutorial-tip">{step.tip}</div></div>
      <div className="aether-deck-tutorial-actions"><button onClick={() => setStepIndex(index => Math.max(0, index - 1))} disabled={stepIndex === 0}><ArrowLeft size={15}/>Назад</button>{stepIndex < steps.length - 1 ? <button className="primary" onClick={() => setStepIndex(index => Math.min(steps.length - 1, index + 1))}>Далее<ArrowRight size={15}/></button> : <button className="primary" onClick={onClose}>Закрыть</button>}</div>
    </div>
  </div>;
}
