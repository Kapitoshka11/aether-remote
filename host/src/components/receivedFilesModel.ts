export interface ReceivedFileRecord {
  id: string;
  name: string;
  size: number;
  path: string;
  timestamp: string;
}

export function upsertReceivedFile(
  previous: ReceivedFileRecord[],
  incoming: ReceivedFileRecord
): ReceivedFileRecord[] {
  return [incoming, ...previous.filter(file => file.id !== incoming.id)];
}
