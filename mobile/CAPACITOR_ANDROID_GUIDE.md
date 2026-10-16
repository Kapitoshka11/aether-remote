# Настройка Capacitor и AndroidManifest.xml для Aether Remote

В данном руководстве описаны шаги по настройке Capacitor и файла `AndroidManifest.xml` для успешной компиляции мобильного приложения под Android и обеспечения работы P2P (PeerJS / WebRTC) и локального сетевого автопоиска.

---

## 1. Конфигурация Capacitor (`capacitor.config.json`)

Убедитесь, что ваш файл конфигурации `capacitor.config.json` в корне проекта имеет следующий вид (параметр `"webDir"` указывает на `"dist"`):

```json
{
  "appId": "com.aether.remote",
  "appName": "Aether Remote",
  "webDir": "dist",
  "server": {
    "cleartext": true,
    "allowNavigation": ["*"]
  },
  "android": {
    "allowMixedContent": true
  }
}
```

---

## 2. Настройка манифеста Android (`app/src/main/AndroidManifest.xml`)

Для корректной работы сетевого взаимодействия, WebRTC и локального автопоиска хостов, в манифесте приложения должны быть заданы разрешения на доступ к Интернету и мониторингу состояния сети, а также включён флаг разрешения HTTP-трафика (`cleartext`).

### Добавление разрешений (Permissions)

Добавьте следующие теги `<uses-permission>` внутри тега `<manifest>` (перед тегом `<application>`):

```xml
<!-- Разрешение на доступ к сети Интернет -->
<uses-permission android:name="android.permission.INTERNET" />

<!-- Разрешение на получение информации о состоянии сетей (Wi-Fi/мобильные данные) -->
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />
```

### Разрешение незащищенного трафика (Cleartext Traffic)

Для работы локального сетевого поиска по протоколам `ws://` (WebSocket) и `http://` без шифрования (SSL/TLS), необходимо добавить атрибут `android:usesCleartextTraffic="true"` в тег `<application>`:

```xml
<application
    android:allowBackup="true"
    android:icon="@mipmap/ic_launcher"
    android:label="@string/app_name"
    android:roundIcon="@mipmap/ic_launcher_round"
    android:supportsRtl="true"
    android:usesCleartextTraffic="true"
    android:theme="@style/Theme.MyApplication">
    
    <!-- Ваша MainActivity и прочие компоненты -->
    
</application>
```

---

## 3. Сборка и запуск приложения

Выполните следующие команды для компиляции веб-ресурсов и синхронизации с нативной частью Android:

1. **Сборка веб-приложения:**
   ```bash
   npm run build
   ```
2. **Синхронизация ресурсов с Android-проектом Capacitor:**
   ```bash
   npx cap sync android
   ```
3. **Открытие проекта в Android Studio для компиляции APK:**
   ```bash
   npx cap open android
   ```
