export default class MultimodalConverter {
  static async convert(type, value) {
    if (type === 'image') {
      return this.processImage(value);
    }
    if (type === 'audio') {
      return this.processAudio(value);
    }
    throw new DOMException(
      `Unsupported media type: ${type}`,
      'NotSupportedError'
    );
  }

  static async processImage(source) {
    // Blob
    if (source instanceof Blob) {
      return this.blobToInlineData(source);
    }

    // BufferSource (ArrayBuffer/View) -> Sniff or Default
    if (ArrayBuffer.isView(source) || source instanceof ArrayBuffer) {
      const buffer = source instanceof ArrayBuffer ? source : source.buffer;
      const base64 = this.arrayBufferToBase64(buffer);
      // Basic sniffing for PNG/JPEG magic bytes
      const u8 = new Uint8Array(buffer);
      let mimeType = 'image/png'; // Default
      if (u8[0] === 0xff && u8[1] === 0xd8) {
        mimeType = 'image/jpeg';
      } else if (u8[0] === 0x89 && u8[1] === 0x50) {
        mimeType = 'image/png';
      }

      return { inlineData: { data: base64, mimeType } };
    }

    // ImageBitmapSource (Canvas, Image, VideoFrame, etc.)
    // We draw to a canvas to standardize to PNG
    return this.canvasSourceToInlineData(source);
  }

  static async processAudio(source) {
    // Blob
    if (source instanceof Blob) {
      return this.blobToInlineData(source);
    }

    // AudioBuffer -> WAV
    if (typeof AudioBuffer !== 'undefined' && source instanceof AudioBuffer) {
      const wavBuffer = this.audioBufferToWav(source);
      const base64 = this.arrayBufferToBase64(wavBuffer);
      return { inlineData: { data: base64, mimeType: 'audio/wav' } };
    }

    // BufferSource -> Assume it's already an audio file (mp3/wav)
    const isArrayBuffer = source instanceof ArrayBuffer || (source && source.constructor && source.constructor.name === 'ArrayBuffer');
    const isView = ArrayBuffer.isView(source) || (source && source.buffer && (source.buffer instanceof ArrayBuffer || source.buffer.constructor.name === 'ArrayBuffer'));

    if (isArrayBuffer || isView) {
      const buffer = isArrayBuffer ? source : source.buffer;
      return {
        inlineData: {
          data: this.arrayBufferToBase64(buffer),
          mimeType: 'audio/wav', // Fallback assumption
        },
      };
    }

    throw new DOMException('Unsupported audio source', 'NotSupportedError');
  }

  // Low Level Converters

  static blobToInlineData(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.error) {
          reject(reader.error);
        } else {
          resolve({
            inlineData: {
              data: reader.result.split(',')[1],
              mimeType: blob.type,
            },
          });
        }
      };
      reader.readAsDataURL(blob);
    });
  }

  static canvasSourceToInlineData(source) {
    const canvas = document.createElement('canvas');
    const w = source.naturalWidth || source.videoWidth || source.width;
    const h = source.naturalHeight || source.videoHeight || source.height;

    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0);

    const dataUrl = canvas.toDataURL('image/png');
    return {
      inlineData: {
        data: dataUrl.split(',')[1],
        mimeType: 'image/png',
      },
    };
  }

  static arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  // Simple WAV Encoder for AudioBuffer
  static audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    let result;
    if (numChannels === 2) {
      result = this.interleave(
        buffer.getChannelData(0),
        buffer.getChannelData(1)
      );
    } else {
      result = buffer.getChannelData(0);
    }

    return this.encodeWAV(result, format, sampleRate, numChannels, bitDepth);
  }

  static interleave(inputL, inputR) {
    const length = inputL.length + inputR.length;
    const result = new Float32Array(length);
    let index = 0;
    let inputIndex = 0;
    while (index < length) {
      result[index++] = inputL[inputIndex];
      result[index++] = inputR[inputIndex];
      inputIndex++;
    }
    return result;
  }

  static encodeWAV(samples, format, sampleRate, numChannels, bitDepth) {
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);

    /* RIFF identifier */
    this.writeString(view, 0, 'RIFF');
    /* RIFF chunk length */
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    /* RIFF type */
    this.writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    this.writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, format, true);
    /* channel count */
    view.setUint16(22, numChannels, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * blockAlign, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, blockAlign, true);
    /* bits per sample */
    view.setUint16(34, bitDepth, true);
    /* data chunk identifier */
    this.writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * bytesPerSample, true);

    this.floatTo16BitPCM(view, 44, samples);

    return buffer;
  }

  static floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }

  static writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}
