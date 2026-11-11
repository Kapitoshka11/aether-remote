const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
const editorPath = path.join(root, 'src', 'aether-deck', 'AetherDeckEditor.tsx');
const tutorialPath = path.join(root, 'src', 'aether-deck', 'AetherDeckTutorial.tsx');
const simpleFieldsPath = path.join(root, 'src', 'aether-deck', 'SimpleActionFields.tsx');

assert.match(app, /Aether Deck/);
assert.match(app, /activeAppTab/);
assert.equal(fs.existsSync(editorPath), true, 'Aether Deck editor must exist');

const editor = fs.readFileSync(editorPath, 'utf8');
for (const behavior of ['createDeck', 'deleteDeck', 'createPage', 'deletePage', 'addControl', 'duplicateControl', 'deleteControl', 'saveDocument', 'exportDeck', 'importDeck', 'configureApplicationRule', 'saveObsSettings']) {
  assert.match(editor, new RegExp(`\\b${behavior}\\b`), `${behavior} is missing from the editor`);
}
assert.match(editor, /columns.*3.*8/s, 'page-specific 3-8 column editor is missing');
assert.match(editor, /drag/i, 'grid controls must support dragging');
assert.match(editor, /resize/i, 'grid controls must support resizing');
assert.match(editor, /actionBranch/, 'toggle A/B action branches are missing');
assert.match(editor, /BUILTIN_ICONS/, 'bundled icon picker is missing');
assert.match(editor, /Условие JSON/, 'conditional action editor is missing');
assert.match(editor, /Режим разработчика/, 'remembered developer-mode switch is missing');
assert.match(editor, /Добавить первый элемент/, 'helpful empty Deck action is missing');
assert.match(editor, /SimpleActionFields/, 'friendly action parameter editor is missing');
assert.match(editor, /developerMode &&/, 'advanced controls are not protected by developer mode');
assert.match(editor, /CONTROL_CHOICES/, 'control chooser descriptions are missing');
assert.match(editor, /compatibleProviders/, 'control-specific action filtering is missing');
assert.match(editor, /isActionCompatible/, 'legacy action compatibility detection is missing');
assert.match(editor, /aether-deck-compatibility-warning/, 'legacy incompatible actions must show a warning');
assert.match(editor, /gridCellFromPointer/, 'grid-level pointer mapping is missing');
assert.match(editor, /dragPreview/, 'drag placement preview state is missing');
assert.match(editor, /aether-deck-drop-preview/, 'drag placement preview is not rendered');
assert.match(editor, /if \(targetRule\) Object\.assign/, 'stale application-rule updates must be ignored safely');
assert.match(editor, /duplicateAction/, 'scenario steps cannot be duplicated');
assert.match(editor, /theme.*dark.*light/s, 'editor must consume the application theme');
assert.match(editor, /data-theme=\{theme\}/, 'editor shell must expose its theme to CSS');
assert.match(editor, /Promise\.resolve\(\)[\s\S]*deckApi\.getDocument/, 'browser preview must render an unavailable state instead of crashing without Electron IPC');
const deckCss = fs.readFileSync(path.join(root, 'src', 'aether-deck', 'aetherDeck.css'), 'utf8');
assert.match(deckCss, /--deck-accent:\s*#f9733d/, 'editor must use the warm orange accent');
assert.match(app, /GradientBackground/, 'orange ambient background must be connected to the desktop shell');
assert.equal(fs.existsSync(path.join(root, 'src', 'components', 'ui', 'typewriter-effect.tsx')), true, 'shared typewriter component must exist');
assert.match(deckCss, /\[data-theme="light"\]/, 'editor must support the application light theme');
assert.match(deckCss, /\.aether-deck-shell select option\s*\{[^}]*background:\s*#11131a;[^}]*color:\s*#f8fafc;/, 'dark-theme select options must remain readable when the native menu opens');
assert.match(deckCss, /\[data-theme="light"\] select option\s*\{[^}]*background:\s*#ffffff;[^}]*color:\s*#0f172a;/, 'light-theme select options must remain readable when the native menu opens');
assert.doesNotMatch(fs.readFileSync(simpleFieldsPath, 'utf8'), /system\.powershell/, 'PowerShell scenario editor must not be exposed');
assert.match(editor, /aether-deck-sidebar-footer[\s\S]*Обучение/, 'Tutorial button must be at the bottom of the left sidebar');
assert.match(editor, /AetherDeckTutorial/, 'Tutorial is not connected to the editor');
assert.match(editor, /developerMode=\{developerMode\}/, 'Tutorial does not receive Developer Mode state');
assert.equal(fs.existsSync(tutorialPath), true, 'Tutorial component must exist');
const tutorial = fs.readFileSync(tutorialPath, 'utf8');
for (const topic of ['Что такое Aether Deck', 'Deck, Page и Control', 'первый Deck', 'добавить кнопку', 'назначить действие', 'Slider', 'Toggle', 'Folder', 'Status', 'макрос', 'панель появляется на телефоне', 'перемещать элементы', 'иконки', 'Импорт и экспорт', 'Режим разработчика']) {
  assert.match(tutorial, new RegExp(topic, 'i'), `Tutorial topic is missing: ${topic}`);
}
for (const navigation of ['Назад', 'Далее', 'Закрыть']) assert.match(tutorial, new RegExp(navigation), `Tutorial navigation is missing: ${navigation}`);
assert.match(tutorial, /stepIndex \+ 1/, 'Tutorial progress is missing');
assert.match(tutorial, /ADVANCED_STEPS/, 'Developer tutorial section is missing');
assert.match(tutorial, /developerMode\s*\?/, 'Advanced tutorial is not conditional');
for (const topic of ['Условия', 'Задержка', 'Повторы', 'Продолжить при ошибке', 'Параметры JSON', 'Динамическое состояние', 'Точная сетка']) {
  assert.match(tutorial, new RegExp(topic, 'i'), `Developer tutorial topic is missing: ${topic}`);
}

console.log('Aether Deck renderer source tests passed.');
