const fs = require('node:fs');
const path = require('node:path');
const { ALLOWED_ACTIONS } = require('../lib/protocol-validation.cjs');
const file = path.join(__dirname, '..', 'protocol_schema.json');
const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
const inbound = [...ALLOWED_ACTIONS].sort();
const outbound = ['TELEMETRY', 'PONG', 'STREAM_STATUS', 'AUDIO_STREAM_STATUS', 'TAKE_SCREENSHOT_RESPONSE',
  'KEY_PRESSED', 'MOUSE_MOVED', 'MOUSE_CLICKED', 'MOUSE_SCROLLED', 'DECK_NAVIGATION', 'STREAM_FRAME_META', 'CLIPBOARD_ITEM', 'CLIPBOARD_TEXT', 'CLIPBOARD_WRITE_ACK',
  'DECK_SNAPSHOT', 'DECK_PATCH', 'DECK_STATE_PATCH', 'DECK_ACTION_RESULT', 'DECK_ASSET_CHUNK', 'DECK_ASSET_ERROR'];
schema.description = 'WebSocket action envelopes. InboundAction is generated from the runtime allowlist; actions contains payload documentation. Status-only responses are documented under their requests.';
schema.definitions.InboundAction = { type: 'string', enum: inbound };
schema.definitions.Action.enum = [...new Set([...inbound, ...outbound, ...Object.keys(schema.actions)])].sort();
for (const action of schema.definitions.Action.enum) {
  if (!schema.actions[action]) schema.actions[action] = {
    description: `${action} ${ALLOWED_ACTIONS.has(action) ? 'client request' : 'host event'}; see PROTOCOL.md for semantics`,
    [ALLOWED_ACTIONS.has(action) ? 'request' : 'response']: {
      type: 'object', required: ['action'], properties: { action: { const: action } }
    }
  };
}
const output = JSON.stringify(schema, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(file, 'utf8') !== output) throw new Error('Protocol schema drift: run node scripts/sync-protocol-schema.cjs');
  console.log(`Protocol schema synchronized: ${inbound.length} inbound actions`);
} else fs.writeFileSync(file, output);
