
class WebAudioManager {
  private audioCtx: AudioContext | null = null;
  private nextStartTime = 0;
  private isMutedState = false;
  private isEnabled = true;

  private initContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public setMuted(muted: boolean) {
    this.isMutedState = muted;
  }

  public isMuted(): boolean {
    return this.isMutedState;
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    if (!enabled && this.audioCtx) {
      this.audioCtx.suspend().catch(() => {});
    }
  }

  public playAudioChunk(base64Data: string, sampleRate = 44100, channels = 2) {
    if (this.isMutedState || !this.isEnabled || !base64Data) return;

    const ctx = this.initContext();
    if (!ctx) return;

    try {
      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      this.playPcmChunk(bytes, sampleRate, channels);
    } catch (e) {
      console.warn('Error decoding Web Audio PCM chunk:', e);
    }
  }

  public playPcmChunk(bytes: Uint8Array, sampleRate = 44100, channels = 2) {
    if (this.isMutedState || !this.isEnabled || bytes.byteLength < 2) return;
    const ctx = this.initContext();
    if (!ctx) return;

    try {
      const alignedBytes = bytes.byteLength - (bytes.byteLength % 2);
      const pcmBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + alignedBytes);
      const int16Samples = new Int16Array(pcmBuffer);
      const totalFrames = Math.floor(int16Samples.length / channels);

      if (totalFrames <= 0) return;

      const audioBuffer = ctx.createBuffer(channels, totalFrames, sampleRate);

      for (let channel = 0; channel < channels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        for (let i = 0; i < totalFrames; i++) {
          const sampleIndex = i * channels + channel;
          const sample = int16Samples[sampleIndex] || 0;
          channelData[i] = sample / 32768.0;
        }
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const currentTime = ctx.currentTime;
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime;
      }

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
    } catch (e) {
      console.warn('Error playing Web Audio PCM chunk:', e);
    }
  }

  public stop() {
    this.nextStartTime = 0;
    if (this.audioCtx) {
      try {
        this.audioCtx.close().catch(() => {});
      } catch (_) {}
      this.audioCtx = null;
    }
  }
}

export const webAudioManager = new WebAudioManager();
