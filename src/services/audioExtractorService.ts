import { saveMediaBlob } from './storageService';

/**
 * Extracts audio track from any uploaded video or audio file (.mp4, .mov, .webm, .mp3, .wav)
 * using Web Audio API `AudioContext.decodeAudioData()`, discarding the video stream
 * and encoding a clean WAV audio Blob URL ready for mixing and Auto-Ducking.
 */
export async function extractAudioFromVideoOrAudioFile(file: File): Promise<{
  audioBlobUrl: string;
  durationSec: number;
}> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtx();

    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      const wavBlob = audioBufferToWavBlob(audioBuffer);
      const audioBlobUrl = URL.createObjectURL(wavBlob);
      const blobId = `bgm-${Date.now()}-${file.name}`;
      saveMediaBlob(blobId, wavBlob).catch(() => {});
      await audioCtx.close();
      return {
        audioBlobUrl,
        durationSec: Math.round(audioBuffer.duration * 10) / 10
      };
    } catch (decodeErr) {
      await audioCtx.close();
      throw decodeErr;
    }
  } catch (err) {
    console.warn('Fallback direct blob audio extraction:', err);
    const fallbackUrl = URL.createObjectURL(file);
    const durationSec = await getMediaDuration(fallbackUrl, file.type.startsWith('video') ? 'video' : 'audio');
    return {
      audioBlobUrl: fallbackUrl,
      durationSec
    };
  }
}

/**
 * Generates an upbeat, cheerful sit-com background instrumental loop via Web Audio OfflineAudioContext
 * so the user can test background music + Auto-Ducking immediately even before uploading an MP4 music video.
 */
export async function generateDemoSitcomMusicBlob(): Promise<{
  audioBlobUrl: string;
  durationSec: number;
  sourceFileName: string;
}> {
  const sampleRate = 44100;
  const durationSec = 24;
  const offlineCtx = new OfflineAudioContext(2, sampleRate * durationSec, sampleRate);

  const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 349.23, 440.0, 392.0];
  const step = 0.35;

  for (let t = 0; t < durationSec; t += step) {
    const idx = Math.floor(t / step) % notes.length;
    const freq = notes[idx];

    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + step - 0.02);

    osc.connect(gain);
    gain.connect(offlineCtx.destination);
    osc.start(t);
    osc.stop(t + step);
  }

  const renderedBuffer = await offlineCtx.startRendering();
  const wavBlob = audioBufferToWavBlob(renderedBuffer);
  const audioBlobUrl = URL.createObjectURL(wavBlob);
  return {
    audioBlobUrl,
    durationSec,
    sourceFileName: '🎵 Demo_Jingle_Commedia_Allegra_Estratto.mp4 (Audio Only)'
  };
}

/**
 * Reads exact duration and extracts a JPEG Base64 keyframe from an uploaded video file
 * using a hidden HTML5 <video> and <canvas> for Gemini 2.5 Flash Vision analysis.
 * Resilient with strict timeout so upload NEVER stalls.
 */
export async function inspectUploadedVideo(file: File): Promise<{
  blobUrl: string;
  durationSec: number;
  base64Keyframe: string;
}> {
  const blobUrl = URL.createObjectURL(file);
  // Persist to indexedDB in background without blocking
  saveMediaBlob(`vid-${Date.now()}-${file.name}`, file).catch(() => {});

  return new Promise((resolve) => {
    let finished = false;
    const finish = (durationSec: number, base64Keyframe: string) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ blobUrl, durationSec, base64Keyframe });
    };

    // Strict 2.5s timeout: if video cannot be decoded/seeked by browser canvas, resolve anyway!
    const timer = setTimeout(() => {
      finish(8, '');
    }, 2500);

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {}
    };

    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 10) / 10 : 8;
      try {
        video.currentTime = Math.min(1.0, Math.max(0.1, dur / 3));
      } catch {
        finish(dur, '');
      }
    };

    video.onseeked = () => {
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 10) / 10 : 8;
      let base64Keyframe = '';
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = 640;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          base64Keyframe = canvas.toDataURL('image/jpeg', 0.75);
        }
      } catch (err) {
        console.warn('Canvas keyframe extraction skipped:', err);
      }
      finish(dur, base64Keyframe);
    };

    video.onerror = () => {
      finish(8, '');
    };

    video.src = blobUrl;
  });
}

/**
 * Optimizes an uploaded photo by creating a responsive Base64 JPEG preview (max 1024px)
 * via Canvas so it never blows up memory, fits in IndexedDB, and sends to Gemini in milliseconds.
 */
export async function generateOptimizedImageBase64(file: File, maxDim = 1024, quality = 0.82): Promise<string> {
  const blobUrl = URL.createObjectURL(file);
  try {
    return await new Promise<string>((resolve, reject) => {
      const img = new Image();
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Image decode timeout'));
      }, 4000);

      const cleanup = () => {
        clearTimeout(timeout);
        img.onload = null;
        img.onerror = null;
        URL.revokeObjectURL(blobUrl);
      };

      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, width);
          canvas.height = Math.max(1, height);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            cleanup();
            resolve('');
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          cleanup();
          resolve(dataUrl);
        } catch {
          cleanup();
          resolve('');
        }
      };

      img.onerror = () => {
        cleanup();
        resolve('');
      };

      img.src = blobUrl;
    });
  } catch {
    return fileToDataUrl(file).catch(() => blobUrl);
  }
}

export async function inspectUploadedPhoto(file: File): Promise<{
  blobUrl: string;
  base64Preview: string;
}> {
  const blobUrl = URL.createObjectURL(file);
  // Persist to indexedDB in background fire-and-forget
  saveMediaBlob(`img-${Date.now()}-${file.name}`, file).catch(() => {});

  let base64Preview = '';
  try {
    base64Preview = await Promise.race([
      generateOptimizedImageBase64(file, 1024, 0.82),
      new Promise<string>((res) => setTimeout(() => res(''), 3000))
    ]);
  } catch {
    base64Preview = '';
  }

  return { blobUrl, base64Preview: base64Preview || blobUrl };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function getMediaDuration(url: string, tag: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(15);
      }
    }, 3000);
    const el = document.createElement(tag);
    el.preload = 'metadata';
    el.src = url;
    el.onloadedmetadata = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        const d = Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 10) / 10 : 15;
        resolve(d);
      }
    };
    el.onerror = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(15);
      }
    };
  });
}

/**
 * Encodes an AudioBuffer into a standard 16-bit PCM WAV Blob
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new ArrayBuffer(length);
  const view = new DataView(out);
  const channels: Float32Array[] = [];
  let sample = 0;
  let offset = 0;
  let pos = 0;

  const setUint16 = (data: number) => {
    view.setUint16(pos, data, true);
    pos += 2;
  };
  const setUint32 = (data: number) => {
    view.setUint32(pos, data, true);
    pos += 4;
  };

  // RIFF identifier
  setUint32(0x46464952);
  setUint32(length - 8);
  setUint32(0x45564157);
  // fmt chunk
  setUint32(0x20746d66);
  setUint32(16);
  setUint16(1);
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2);
  setUint16(16);
  // data chunk
  setUint32(0x61746164);
  setUint32(length - pos - 4);

  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < length) {
    for (let i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([out], { type: 'audio/wav' });
}
