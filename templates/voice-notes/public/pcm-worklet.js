// Turns microphone samples into 16-bit PCM pieces of about 50 ms, the format the API reads with the least delay.
class Pcm extends AudioWorkletProcessor {
  constructor() { super(); this.size = Math.round(sampleRate * 0.05); this.buffer = new Int16Array(this.size); this.used = 0; }
  process(inputs) {
    const samples = inputs[0][0];
    if (!samples) return true;
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.used++] = Math.max(-32768, Math.min(32767, samples[i] * 32768));
      if (this.used === this.size) { this.port.postMessage(this.buffer.slice().buffer); this.used = 0; }
    }
    return true;
  }
}
registerProcessor('pcm', Pcm);
