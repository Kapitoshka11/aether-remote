import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Module from 'node:module';
import path from 'node:path';

const bundle = await build({
  entryPoints: ['src/components/MainPairingCard.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['react', 'react-dom'],
});
const source = bundle.outputFiles[0].text;
const compiled = new Module(path.resolve('test/main-pairing-card-render-bundle.cjs'));
compiled.filename = path.resolve('test/main-pairing-card-render-bundle.cjs');
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(source, compiled.filename);
const { MainPairingCard } = compiled.exports;

const html = renderToStaticMarkup(React.createElement(MainPairingCard, {
  pin: '654321',
  ipAddress: '192.168.1.42',
  networkEndpoints: [
    { address: '192.168.1.42', interfaceName: 'Wi-Fi' },
    { address: '100.84.2.10', interfaceName: 'WireGuard Tunnel' },
  ],
  port: 8080,
  language: 'RU',
  theme: 'dark',
  tlsFingerprint: `SHA256:${'AB'.repeat(32)}`,
}));

assert.match(html, /Адрес для QR \(LAN\/VPN\)/);
assert.match(html, /192\.168\.1\.42/);
assert.match(html, /100\.84\.2\.10/);
assert.match(html, /WireGuard Tunnel/);
console.log('Pairing card exposes LAN and VPN QR endpoints.');
