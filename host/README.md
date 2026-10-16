# Aether Remote Host Agent

Windows host for Aether Remote. It provides authenticated remote control, clipboard and file exchange, screen and audio streaming, Wake-on-LAN integration, account relay connectivity, and Aether Deck actions for the Android client.

The Electron implementation is the production host. The experimental Rust/Tauri workspace is intentionally excluded from the 2.5.0 release repository until it provides the same TLS and protocol guarantees.

## Requirements

- Windows 10 or newer.
- Node.js 20 or newer.
- Python 3 for Python compatibility tests and the optional standalone host.

## Local development

```powershell
npm install
npm run dev
npm start
```

Use `npm run build` for the production web bundle and `npm run electron:build` for the Windows installer.

## Verification

```powershell
npm test
npm run lint
npm run build
```

The Electron host creates a persistent self-signed TLS identity in its Electron user-data directory and exposes only HTTPS/WSS on the LAN control port. Pair the Android client again after replacing that identity so it can deliberately accept the new certificate fingerprint.

## Standalone Python host

The Python fallback requires `websockets`, `cryptography`, `psutil`, `pyautogui`, `pyperclip`, `qrcode`, `Pillow`, `zeroconf`, and the PySide6 modules imported by `aether_server.py`. Install those packages in an isolated virtual environment, then run `python aether_server.py`. It creates its TLS identity under `%USERPROFILE%\.aether_remote\tls` and uses HTTPS/WSS just like the Electron host.

## Security

Do not commit `.env` files, private keys, certificates, keystores, account tokens, generated installers, or release archives. Shared protocol changes must be synchronized with the Android client and `PROTOCOL.md`.
