const { Duplex } = require('node:stream');
const MAX_FRAME = 256 * 1024;
const WINDOW = 1024 * 1024;
const MAX_QUEUE = 2 * 1024 * 1024;

class RelayDuplex extends Duplex {
  constructor(socket) {
    super({ readableHighWaterMark: MAX_FRAME, writableHighWaterMark: MAX_FRAME });
    this.socket = socket;
    this.sent = 0;
    this.acked = 0;
    this.received = 0;
    this.ackSent = 0;
    this.pendingWrite = null;
    this.blockedRead = false;
    this.remoteAddress = '127.0.0.1';
    this.remotePort = 0;
    this.onMessage = (raw, binary) => {
      try {
        const frame = Buffer.from(raw);
        if (!binary || frame.length < 5 || frame.length > MAX_FRAME) throw new Error('invalid_relay_frame');
        const count = frame.readUInt32BE(1);
        if (frame[0] === 1) {
          if (frame.length !== 5 || count < this.acked || count > this.sent) throw new Error('invalid_relay_ack');
          this.acked = count;
          this.flushWrite();
        } else if (frame[0] === 0) {
          if (frame.length === 5 || count !== this.received || this.received + frame.length - 5 > 0xffffffff) throw new Error('invalid_relay_order');
          this.received += frame.length - 5;
          if (this.received - this.ackSent > WINDOW || this.readableLength + frame.length - 5 > MAX_QUEUE) throw new Error('relay_receive_overflow');
          if (this.push(frame.subarray(5))) this.sendAck(); else this.blockedRead = true;
        } else throw new Error('invalid_relay_type');
      } catch (error) { this.destroy(error); }
    };
    socket.on('message', this.onMessage);
    socket.once('close', () => this.destroy());
    socket.once('error', () => this.destroy(new Error('relay_socket_failed')));
  }
  _read() {
    if (this.blockedRead) { this.blockedRead = false; this.sendAck(); }
  }
  sendAck() {
    if (this.received === this.ackSent || this.destroyed) return;
    const frame = Buffer.alloc(5);
    frame[0] = 1;
    frame.writeUInt32BE(this.received, 1);
    this.ackSent = this.received;
    this.socket.send(frame, { binary: true }, error => { if (error) this.destroy(new Error('relay_send_failed')); });
  }
  _write(chunk, _encoding, callback) {
    if (chunk.length > MAX_QUEUE || this.writableLength > MAX_QUEUE) { callback(new Error('relay_send_overflow')); return; }
    this.pendingWrite = { chunk, offset: 0, callback };
    this.flushWrite();
  }
  flushWrite() {
    const pending = this.pendingWrite;
    if (!pending || this.destroyed) return;
    while (pending.offset < pending.chunk.length) {
      const size = Math.min(MAX_FRAME - 5, pending.chunk.length - pending.offset, WINDOW - (this.sent - this.acked));
      if (size === 0) return;
      if (this.socket.readyState !== 1 || this.socket.bufferedAmount + size + 5 > MAX_QUEUE || this.sent + size > 0xffffffff) {
        this.destroy(new Error('relay_send_overflow')); return;
      }
      const frame = Buffer.allocUnsafe(size + 5);
      frame[0] = 0;
      frame.writeUInt32BE(this.sent, 1);
      pending.chunk.copy(frame, 5, pending.offset, pending.offset + size);
      pending.offset += size;
      this.sent += size;
      this.socket.send(frame, { binary: true }, error => { if (error) this.destroy(new Error('relay_send_failed')); });
    }
    this.pendingWrite = null;
    pending.callback();
  }
  _final(callback) { this.socket.close(1000, 'Tunnel finished'); callback(); }
  _destroy(error, callback) {
    this.socket.removeListener('message', this.onMessage);
    const pending = this.pendingWrite;
    this.pendingWrite = null;
    if (pending) pending.callback(error || new Error('relay_closed'));
    if (this.socket.readyState === 1 || this.socket.readyState === 0) this.socket.terminate();
    callback(error);
  }
  setTimeout() { return this; }
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
}

module.exports = { RelayDuplex, MAX_FRAME, WINDOW, MAX_QUEUE };
