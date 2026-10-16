
export interface PairingCodeComponents {
  octet3: number;
  octet4: number;
  hardwarePin: string;
}

export type ConnectionFailureType =
  | 'HOST_OFFLINE'
  | 'INVALID_PIN'
  | 'HOST_LOCKED_OUT'
  | 'NETWORK_DISCONNECTED'
  | 'TLS_MITM_WARNING'
  | 'UNKNOWN' | 'AUTH_TIMEOUT';

export interface ConnectionSecurityStatus {
  scheme: 'ws' | 'wss' | 'webrtc';
  transport: 'WebSocket' | 'P2P (WebRTC)';
  isSecure: boolean;
  fingerprint?: string;
  fingerprintVerified?: boolean;
}

export function parsePairingCode(pinStr: string): PairingCodeComponents | null {
  const cleanPin = pinStr.replace(/\D/g, '');
  if (cleanPin.length !== 9) return null;

  const octet3 = parseInt(cleanPin.slice(0, 3), 10);
  const octet4 = parseInt(cleanPin.slice(3, 6), 10);
  const hardwarePin = cleanPin.slice(6, 9);

  if (isNaN(octet3) || isNaN(octet4) || octet3 > 255 || octet4 > 255) {
    return null;
  }

  return { octet3, octet4, hardwarePin };
}

export function generateSubnetCandidates(
  prefix: string,
  targetOctet3: number,
  targetOctet4: number
): string[] {
  const candidateIps: string[] = [];
  const primaryIp = `${prefix}${targetOctet3}.${targetOctet4}`;
  candidateIps.push(primaryIp);

  for (let host = 1; host <= 254; host++) {
    if (host !== targetOctet4) {
      candidateIps.push(`${prefix}${targetOctet3}.${host}`);
    }
  }

  if (targetOctet3 !== 0 && targetOctet3 !== 1) {
    const adjOctet3 = targetOctet3 === 0 ? 1 : 0;
    for (let host = 1; host <= 254; host++) {
      candidateIps.push(`${prefix}${adjOctet3}.${host}`);
    }
  }

  return candidateIps;
}

export function getDiagnosticInfo(
  failureType: ConnectionFailureType,
  lang: 'ru' | 'en' = 'ru'
): { title: string; detail: string; icon: string } {
  switch (failureType) {
    case 'HOST_OFFLINE':
      return {
        title: lang === 'ru' ? 'Хост недоступен / Оффлайн' : 'Host Offline / Unreachable',
        detail:
          lang === 'ru'
            ? 'ПК-сервер не ответил по указанному IP. Проверьте, запущен ли Aether Host на ПК и подсоединены ли вы к одной Wi-Fi сети.'
            : 'PC server did not respond at target IP. Ensure Aether Host is running on PC and both devices share Wi-Fi.',
        icon: 'wifi-off',
      };
    case 'INVALID_PIN':
      return {
        title: lang === 'ru' ? 'Неверный PIN-код' : 'Invalid PIN Code',
        detail:
          lang === 'ru'
            ? 'Сервер отверг PIN-код. Перепроверьте 9-значный код на экране Aether Host.'
            : 'Server rejected PIN code. Double check the 9-digit code shown in Aether Host on PC.',
        icon: 'key-round',
      };
    case 'HOST_LOCKED_OUT':
      return {
        title: lang === 'ru' ? 'Вход заблокирован (60с)' : 'Login Locked Out (60s)',
        detail:
          lang === 'ru'
            ? 'Превышено число неверных попыток авторизации. Повторите попытку через минуту.'
            : 'Exceeded maximum failed auth attempts. Please wait 60s before retrying.',
        icon: 'shield-alert',
      };
    case 'NETWORK_DISCONNECTED':
      return {
        title: lang === 'ru' ? 'Нет подключения к сети' : 'Network Disconnected',
        detail:
          lang === 'ru'
            ? 'На устройстве отключён Wi-Fi или локальная сеть. Включите Wi-Fi для подключения.'
            : 'Device Wi-Fi or network interface is disabled. Enable Wi-Fi to connect.',
        icon: 'signal-slash',
      };
    case 'TLS_MITM_WARNING':
      return {
        title: lang === 'ru' ? 'Внимание: Изменение TLS-отпечатка!' : 'Warning: TLS Fingerprint Changed!',
        detail:
          lang === 'ru'
            ? 'Отпечаток TLS сертификата хоста не совпадает с сохранённым! Возможна подмена хоста или атака MITM.'
            : 'Host TLS certificate fingerprint differs from stored pin! Potential host spoofing or MITM attack.',
        icon: 'triangle-alert',
      };
    case 'AUTH_TIMEOUT':
      return {
        title: lang === 'ru' ? 'Тайм-аут подтверждения' : 'Confirmation Timeout',
        detail:
          lang === 'ru'
            ? 'Истекло время ожидания подтверждения на ПК.'
            : 'Timeout waiting for confirmation on PC.',
        icon: 'clock',
      };
    default:
      return {
        title: lang === 'ru' ? 'Ошибка подключения' : 'Connection Failure',
        detail:
          lang === 'ru'
            ? 'Произошла непредвиденная ошибка сети. Перепроверьте параметры подключения.'
            : 'An unexpected network error occurred. Please verify connection settings.',
        icon: 'alert-circle',
      };
  }
}
