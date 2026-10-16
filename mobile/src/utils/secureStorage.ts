
export interface SavedPc {
  id: string;
  hostName: string;
  hostIp: string;
  hostPort: string;
  pin?: string;
  macAddress?: string;
  lastConnected: number;
  isAutoDiscovered?: boolean;
}

const STORAGE_PREFIX = 'aether_secure_v2_';
const sessionTokens = new Map<string, string>();

if (typeof localStorage !== 'undefined') {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${STORAGE_PREFIX}token_`)) localStorage.removeItem(key);
    }
  } catch (_) {}
}

function obfuscateSecret(value: string): string {
  try {
    const key = 'AetherSecureKey2026';
    let result = '';
    for (let i = 0; i < value.length; i++) {
      result += String.fromCharCode(value.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(result);
  } catch (_) {
    return btoa(value);
  }
}

function deobfuscateSecret(encoded: string): string {
  try {
    const decoded = atob(encoded);
    const key = 'AetherSecureKey2026';
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  } catch (_) {
    try {
      return atob(encoded);
    } catch (__) {
      return '';
    }
  }
}

export const secureStorage = {
  saveSessionToken(ip: string, token: string): void {
    if (!ip || !token) return;
    sessionTokens.set(ip, token);
    try { localStorage.removeItem(`${STORAGE_PREFIX}token_${ip}`); } catch (_) {}
  },

  getSessionToken(ip: string): string | null {
    if (!ip) return null;
    try {
      localStorage.removeItem(`${STORAGE_PREFIX}token_${ip}`);
      return sessionTokens.get(ip) || null;
    } catch (e) {
      return null;
    }
  },

  removeSessionToken(ip: string): void {
    if (!ip) return;
    try {
      sessionTokens.delete(ip);
      localStorage.removeItem(`${STORAGE_PREFIX}token_${ip}`);
    } catch (_) {}
  },

  saveTlsFingerprint(ip: string, fingerprint: string): void {
    if (!ip || !fingerprint) return;
    try {
      const encrypted = obfuscateSecret(fingerprint);
      localStorage.setItem(`${STORAGE_PREFIX}tls_fp_${ip}`, encrypted);
    } catch (e) {
      console.error('Failed to save TLS fingerprint:', e);
    }
  },

  getTlsFingerprint(ip: string): string | null {
    if (!ip) return null;
    try {
      const encrypted = localStorage.getItem(`${STORAGE_PREFIX}tls_fp_${ip}`);
      if (!encrypted) return null;
      return deobfuscateSecret(encrypted);
    } catch (_) {
      return null;
    }
  },

  saveSavedPcs(pcs: SavedPc[]): void {
    try {
      const withoutPins = pcs.map(({ pin: _pin, ...pc }) => ({ ...pc, pin: '' }));
      const encoded = obfuscateSecret(JSON.stringify(withoutPins));
      localStorage.setItem(`${STORAGE_PREFIX}saved_pcs`, encoded);
    } catch (e) {
      console.error('Failed to save PCs list:', e);
    }
  },

  getSavedPcs(): SavedPc[] {
    try {
      const encoded = localStorage.getItem(`${STORAGE_PREFIX}saved_pcs`);
      if (!encoded) {
        const legacy = localStorage.getItem('aether_saved_pcs');
        if (legacy) {
          const parsed = JSON.parse(legacy);
          localStorage.removeItem('aether_saved_pcs');
          return Array.isArray(parsed) ? parsed.map((pc) => ({ ...pc, pin: '' })) : [];
        }
        return [];
      }
      const json = deobfuscateSecret(encoded);
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.map((pc) => ({ ...pc, pin: '' })) : [];
    } catch (_) {
      return [];
    }
  },
};
