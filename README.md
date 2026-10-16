<p align="center">
  <img src="assets/aether-remote-banner.svg" alt="Aether Remote" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.5.0-F9733D?style=for-the-badge" alt="Version 2.5.0">
  <img src="https://img.shields.io/badge/Android-24%2B-3DDC84?style=for-the-badge&logo=android&logoColor=white" alt="Android 24+">
  <img src="https://img.shields.io/badge/Windows-10%2B-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows 10+">
  <img src="https://img.shields.io/badge/status-private_beta-171412?style=for-the-badge" alt="Private beta">
</p>

<p align="center">
  <strong>Безопасное управление Windows-компьютером с Android.</strong><br>
  Один проект для подключения, стриминга, обмена файлами и персональной панели Aether Deck.
</p>

<p align="center">
  <a href="https://t.me/+DqicSUkTJEAwNzI6"><strong>Telegram проекта</strong></a>
  &nbsp;•&nbsp;
  <a href="https://kapitoshkadev1.netlify.app/#"><strong>Сайт разработчика</strong></a>
</p>

---

## Возможности

- Защищённое сопряжение телефона и компьютера по QR-коду или коду подключения.
- Управление мышью, клавиатурой, мультимедиа и системной громкостью Windows.
- Передача файлов и буфера обмена между устройствами.
- Трансляция экрана и фонового звука.
- Aether Deck: кнопки, переключатели, слайдеры, папки, макросы и пользовательские иконки.
- Подключение по локальной сети, VPN или через account relay.
- Wake-on-LAN и удалённое пробуждение зарегистрированных устройств.

## Состав репозитория

| Каталог | Назначение | Технологии |
| --- | --- | --- |
| [`mobile/`](mobile/) | Нативное Android-приложение | Kotlin, Jetpack Compose, Material 3, OkHttp |
| [`host/`](host/) | Агент для Windows | Electron, React, TypeScript, Node.js |

```mermaid
flowchart LR
    A[Android · Aether Remote] <-->|HTTPS / WSS| B[Windows · Host Agent]
    A -. защищённый relay .-> C[Account Relay]
    C -. защищённый relay .-> B
    B --> D[Экран · звук · файлы · управление]
```

## Интерфейс

<p align="center">
  <img src="mobile/docs/audit-2.0.0/settings-light.png" alt="Светлая тема Aether Remote" width="260">
  &nbsp;&nbsp;
  <img src="mobile/docs/audit-2.0.0/settings-landscape.png" alt="Тёмная тема Aether Remote" width="560">
</p>

## Быстрый старт

### Android

Требуются JDK 17+ и Android SDK 36. Из каталога `mobile/`:

```powershell
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:installDebug
```

### Windows-host

Требуются Windows 10+ и Node.js 20+. Из каталога `host/`:

```powershell
npm install
npm run build
npm start
```

После запуска host покажет данные сопряжения. Откройте мобильное приложение, выберите подключение к ПК и отсканируйте QR-код.

## Проверка проекта

```powershell
# mobile/
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
npm install
npm run lint
npm test
npm run build

# host/
npm install
npm test
npm run lint
npm run build
```

## Безопасность

Aether Remote использует HTTPS/WSS, проверку TLS-отпечатка хоста, ограниченный IPC и валидацию входящих протокольных сообщений. Секреты, keystore-файлы, локальные `.env`, сертификаты и готовые установщики исключены из репозитория.

Уязвимости следует сообщать приватно через GitHub Security Advisories. Подробности находятся в [`SECURITY.md`](SECURITY.md).

## Версия

Текущая версия: **2.5.0**. Android: `versionCode 27`, `versionName 2.5.0`. ПК-клиент выпускается на Electron; экспериментальный Rust/Tauri-прототип намеренно не входит в релизный репозиторий.

---

<p align="center">
  Создано <a href="https://kapitoshkadev1.netlify.app/#"><strong>KapitoshkaDev</strong></a><br>
  Новости и обновления — в <a href="https://t.me/+DqicSUkTJEAwNzI6"><strong>Telegram-канале Aether Remote</strong></a>
</p>
