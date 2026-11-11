import assert from 'node:assert/strict';
import { upsertReceivedFile, type ReceivedFileRecord } from '../src/components/receivedFilesModel.ts';

const first: ReceivedFileRecord = {
  id: 'transfer-1',
  name: 'photo.png',
  size: 120,
  path: 'C:\\Downloads\\photo.png',
  timestamp: '10:00:00'
};
const refreshed: ReceivedFileRecord = { ...first, size: 121, timestamp: '10:00:01' };
const second: ReceivedFileRecord = {
  id: 'transfer-2',
  name: 'notes.txt',
  size: 5,
  path: 'C:\\Downloads\\notes.txt',
  timestamp: '10:01:00'
};

assert.deepEqual(upsertReceivedFile([], first), [first]);
assert.deepEqual(upsertReceivedFile([first], refreshed), [refreshed]);
assert.deepEqual(upsertReceivedFile([first], second), [second, first]);
assert.deepEqual(upsertReceivedFile([second, first], refreshed), [refreshed, second]);

console.log('Received file model tests passed.');
