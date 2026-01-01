// Audio Worklet Processor for Komilion Voice
// Processes microphone input and sends 100ms chunks at 24kHz
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      this.buffer.push(...input[0]);
      
      // Send 100ms chunks (2400 samples at 24kHz)
      while (this.buffer.length >= 2400) {
        const chunk = this.buffer.splice(0, 2400);
        this.port.postMessage({ audio: new Float32Array(chunk) });
      }
    }
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);

