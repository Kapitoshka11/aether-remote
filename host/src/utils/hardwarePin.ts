
export interface Universal9Payload {
  code9: string;
  formattedCode: string;
  p1: string;
  p2: string;
  p3: string;
}

export function getBrowserHardwarePin(): string {
  const dynamicPin = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(dynamicPin).padStart(6, '0');
}

export function encodeUniversal9Code(ipAddress: string = '192.168.1.50', pin3?: string): Universal9Payload {
  const parts = (ipAddress || '192.168.1.50').trim().split('.');
  const oct3 = parts.length >= 3 ? parseInt(parts[2], 10) : 1;
  const oct4 = parts.length >= 4 ? parseInt(parts[3], 10) : 50;
  
  const p1 = (isNaN(oct3) ? 1 : oct3).toString().padStart(3, '0');
  const p2 = (isNaN(oct4) ? 50 : oct4).toString().padStart(3, '0');
  
  let cleanPin = (pin3 || '').replace(/\D/g, '');
  if (cleanPin.length !== 6) {
    cleanPin = getBrowserHardwarePin();
  }
  const p3 = cleanPin;
  
  const code9 = `${p1}${p2}${p3}`;
  const formattedCode = `${p1} - ${p2} - ${p3}`;

  return { code9, formattedCode, p1, p2, p3 };
}

export function generateSmartPin(ipAddress?: string, customSalt?: string): string {
  const payload = encodeUniversal9Code(ipAddress, customSalt);
  return payload.p3;
}

export function generatePinFromUuid(uuidStr: string): string {
  return getBrowserHardwarePin();
}
