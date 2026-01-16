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
      const u8 = source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      const buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      const base64 = this.arrayBufferToBase64(buffer);
      const mimeType = this.#sniffImageMimeType(u8) || 'image/png';

      return { inlineData: { data: base64, mimeType } };
    }

    // ImageBitmapSource (Canvas, Image, VideoFrame, etc.)
    // We draw to a canvas to standardize to PNG
    return this.canvasSourceToInlineData(source);
  }

  static #sniffImageMimeType(u8) {
    const len = u8.length;
    if (len < 4) return null;

    // JPEG: FF D8 FF
    if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
      return 'image/jpeg';
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      u8[0] === 0x89 &&
      u8[1] === 0x50 &&
      u8[2] === 0x4e &&
      u8[3] === 0x47 &&
      u8[4] === 0x0d &&
      u8[5] === 0x0a &&
      u8[6] === 0x1a &&
      u8[7] === 0x0a
    ) {
      return 'image/png';
    }

    // GIF: GIF87a / GIF89a
    if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38) {
      return 'image/gif';
    }

    // WebP: RIFF (offset 0) + WEBP (offset 8)
    if (
      u8[0] === 0x52 &&
      u8[1] === 0x49 &&
      u8[2] === 0x46 &&
      u8[3] === 0x46 &&
      u8[8] === 0x57 &&
      u8[9] === 0x45 &&
      u8[10] === 0x42 &&
      u8[11] === 0x50
    ) {
      return 'image/webp';
    }

    // BMP: BM
    if (u8[0] === 0x42 && u8[1] === 0x4d) {
      return 'image/bmp';
    }

    // ICO: 00 00 01 00
    if (u8[0] === 0x00 && u8[1] === 0x00 && u8[2] === 0x01 && u8[3] === 0x00) {
      return 'image/x-icon';
    }

    // TIFF: II* (LE) / MM* (BE)
    if (
      (u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 0x2a) ||
      (u8[0] === 0x4d && u8[1] === 0x4d && u8[2] === 0x2a)
    ) {
      return 'image/tiff';
    }

    // ISOBMFF (AVIF / HEIC / HEIF)
    // "ftyp" at offset 4
    if (
      u8[4] === 0x66 &&
      u8[5] === 0x74 &&
      u8[6] === 0x79 &&
      u8[7] === 0x70
    ) {
      const type = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
      if (type === 'avif' || type === 'avis') return 'image/avif';
      if (type === 'heic' || type === 'heix' || type === 'hevc' || type === 'hevx') return 'image/heic';
      if (type === 'mif1' || type === 'msf1') return 'image/heif';
    }

    // JPEG XL: FF 0A or container bits
    if (u8[0] === 0xff && u8[1] === 0x0a) return 'image/jxl';
    // Container: 00 00 00 0c 4a 58 4c 20 0d 0a 87 0a (JXL )
    if (u8[0] === 0x00 && u8[4] === 0x4a && u8[5] === 0x58 && u8[6] === 0x4c) return 'image/jxl';

    // JPEG 2000
    if (u8[0] === 0x00 && u8[4] === 0x6a && u8[5] === 0x50 && u8[6] === 0x20) return 'image/jp2';

    // SVG: Check for <svg or <?xml (heuristics)
    const preview = String.fromCharCode(...u8.slice(0, 100)).toLowerCase();
    if (preview.includes('<svg') || preview.includes('<?xml')) {
      return 'image/svg+xml';
    }

    return null;
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
