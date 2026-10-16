export type ConnectionStatus = 'LISTENING_FOR_CLIENT' | 'CLIENT_CONNECTED' | 'BLOCKED_BRUTE_FORCE';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  type: 'AUTH_OK' | 'AUTH_FAILED' | 'AUTH_BLOCKED' | 'POWER' | 'MEDIA' | 'SYSTEM' | 'SCREEN_STREAM' | 'SYSTEM_INFO';
  message: string;
  status: 'success' | 'warning' | 'error' | 'info';
  clientIp?: string;
}

export interface ConnectedDeviceInfo {
  deviceModel: string;
  ipAddress: string;
  connectedAt: string;
  uptimeSeconds: number;
  batteryLevel?: number;
  osName?: string;
}

export interface SystemStats {
  cpuUsage: number;
  ramUsage: number;
  ramUsedGb: number;
  ramTotalGb: number;
  netUploadMb: number;
  netDownloadMb: number;
  hostname: string;
  osVersion: string;
  uptimeSeconds: number;
  track?: string;
  artist?: string;
  isPlaying?: boolean;
  isScreenStreaming?: boolean;
}

export interface RemoteCommand {
  action: string;
  pin?: string;
  command?: string;
  quality?: number;
  resolution?: string;
  text?: string;
  sessionToken?: string;
  [key: string]: any;
}

export interface CommandResponse {
  action?: string;
  status?: string;
  cooldown?: number;
  host?: string;
  output?: string;
  data?: string;
  fps?: number;
  latency_ms?: number;
  error?: string;
}
