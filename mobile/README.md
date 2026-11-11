# Aether Remote Mobile

Native Android client for controlling an Aether Remote host over an authenticated local or relay connection. The production application is the Kotlin/Jetpack Compose project in `app/`; the React/Vite project in the repository root is a development preview and does not replace Android validation.

## Requirements

- JDK 17 or newer.
- Android SDK 36 with Build Tools installed.
- Node.js 20 or newer for the optional web preview.

## Android development

Set `ANDROID_HOME`, then run from the repository root:

```powershell
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:lintDebug
```

The debug APK is created at `app/build/outputs/apk/debug/app-debug.apk`. Device tests require a connected emulator or phone:

```powershell
.\gradlew.bat :app:connectedDebugAndroidTest
```

## Web preview

```powershell
npm install
npm run dev
npm run lint
npm test
npm run build
```

## Security

The Android client accepts HTTPS/WSS hosts and verifies the host certificate fingerprint established during pairing. Plaintext LAN transport is rejected. Pairing codes, session tokens, signing keys, keystores, and local environment files must never be committed.

Release signing reads `KEYSTORE_PATH`, `STORE_PASSWORD`, `KEY_ALIAS`, and `KEY_PASSWORD` from the build environment. The release build fails closed when required signing values are absent.

Protocol compatibility is documented in `PROTOCOL_SPEC.md`. The matching Windows host is maintained in the separate `aether-remote-host-agent` repository.
