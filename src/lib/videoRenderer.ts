export interface RenderShotVideoParams {
  frameImageBase64: string;
  framesBase64?: string[];
  audioWavBase64?: string | null;
  dialogueIta?: string;
  speakerName?: string;
  cameraAngle?: string;
  shotLabel?: string;
  durationSeconds?: number;
  aspectRatio?: '9:16' | '16:9';
  compactForCloud?: boolean;
  onProgress?: (percent: number) => void;
}

// Singleton AudioContext sbloccato al momento del clic dell'utente (prima di qualsiasi await fetch)
let sharedAudioCtx: AudioContext | null = null;

export function unlockSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Conversione video Base64 fallita.'));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function pickSupportedVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'video/webm';
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'video/webm';
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.slice(0, 3);
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  scale: number,
  panX: number,
  panY: number,
  rotationRad: number,
  alpha = 1
) {
  const imgRatio = img.width / img.height;
  const canvasRatio = width / height;
  let drawW = width;
  let drawH = height;
  if (imgRatio > canvasRatio) {
    drawH = height;
    drawW = height * imgRatio;
  } else {
    drawW = width;
    drawH = width / imgRatio;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(width / 2 + panX, height / 2 + panY);
  ctx.rotate(rotationRad);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

/**
 * Renderizza un singolo Shot di 5s animando i fotogrammi generati da Nano Banana (`framesBase64`)
 * sincronizzati con la voce recitata italiana.
 */
export async function renderShotVideoDataUrl(
  params: RenderShotVideoParams
): Promise<string> {
  const {
    frameImageBase64,
    framesBase64 = [],
    audioWavBase64,
    dialogueIta = '',
    speakerName = '',
    shotLabel = '',
    durationSeconds = 5,
    aspectRatio = '9:16',
    compactForCloud = false,
    onProgress,
  } = params;

  const width =
    aspectRatio === '9:16'
      ? compactForCloud
        ? 480
        : 720
      : compactForCloud
      ? 854
      : 1280;
  const height =
    aspectRatio === '9:16'
      ? compactForCloud
        ? 854
        : 1280
      : compactForCloud
      ? 480
      : 720;

  // Attacchiamo temporaneamente il canvas al DOM (invisibile fuori schermo)
  // perché Chrome altrimenti mette in pausa captureStream() sui canvas non montati nel DOM!
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'fixed';
  canvas.style.left = '-9999px';
  canvas.style.top = '0px';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.pointerEvents = 'none';
  canvas.style.opacity = '0.01';
  document.body.appendChild(canvas);

  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Impossibile inizializzare il motore grafico Canvas.');
    }

    const rawFrameUrls =
      framesBase64.length > 0 ? framesBase64 : [frameImageBase64];
    const loadedFrames: HTMLImageElement[] = [];
    for (const url of rawFrameUrls) {
      try {
        const im = await loadImage(url);
        loadedFrames.push(im);
      } catch {
        // ignora frame non valido
      }
    }
    if (loadedFrames.length === 0) {
      loadedFrames.push(await loadImage(frameImageBase64));
    }

    // Disegna subito il primo fotogramma prima di far partire MediaRecorder
    drawCoverImage(ctx, loadedFrames[0], width, height, 1.03, 0, 0, 0, 1);

    const audioCtx = unlockSharedAudioContext();
    let dest: MediaStreamAudioDestinationNode | null = null;
    let analyser: AnalyserNode | null = null;
    let freqData: Uint8Array<ArrayBuffer> | null = null;
    let audioBuffer: AudioBuffer | null = null;

    if (audioCtx && audioCtx.state === 'running') {
      try {
        dest = audioCtx.createMediaStreamDestination();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

        if (audioWavBase64) {
          const res = await fetch(audioWavBase64);
          const arrayBuf = await res.arrayBuffer();
          audioBuffer = await audioCtx.decodeAudioData(arrayBuf);
        }
      } catch (e) {
        console.warn('Audio setup fallback:', e);
      }
    }

    const canvasStream = canvas.captureStream(24);
    const videoTrack = canvasStream.getVideoTracks()[0] as MediaStreamTrack & {
      requestFrame?: () => void;
    };

    const combinedTracks: MediaStreamTrack[] = [
      ...canvasStream.getVideoTracks(),
    ];
    if (dest && audioCtx && audioCtx.state === 'running') {
      combinedTracks.push(...dest.stream.getAudioTracks());
    }

    const combinedStream = new MediaStream(combinedTracks);
    const mimeType = pickSupportedVideoMimeType();
    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: compactForCloud ? 500_000 : 2_400_000,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    const stopPromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: mimeType }));
      };
    });

    recorder.start(100);

    if (audioCtx && audioCtx.state === 'running' && dest) {
      if (audioBuffer && analyser) {
        const sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(analyser);
        analyser.connect(dest);
        sourceNode.start(0);
      } else {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain);
        gain.connect(dest);
        osc.start(0);
        osc.stop(audioCtx.currentTime + durationSeconds);
      }
    }

    const startTime = performance.now();
    const totalMs = durationSeconds * 1000;

    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(1, elapsed / totalMs);
        if (onProgress) {
          onProgress(Math.min(99, Math.round(progress * 100)));
        }

        let voiceEnergy = 0.35 + 0.25 * Math.abs(Math.sin(elapsed * 0.015));
        if (analyser && freqData) {
          analyser.getByteFrequencyData(freqData);
          let sum = 0;
          for (let i = 0; i < 24; i++) {
            sum += freqData[i];
          }
          const measured = Math.min(1, sum / (24 * 150));
          if (measured > 0.02) {
            voiceEnergy = measured;
          }
        }

        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 0, width, height);

        const talkBounceY =
          Math.sin(elapsed * 0.024) *
          (height * 0.009 * (0.35 + voiceEnergy * 1.5));
        const talkTiltRad =
          Math.sin(elapsed * 0.012) * (0.014 * (0.4 + voiceEnergy));
        const baseScale = 1.03 + progress * 0.06 + voiceEnergy * 0.028;
        const panX = Math.sin(progress * Math.PI * 1.5) * (width * 0.02);
        const panY = talkBounceY;

        if (loadedFrames.length === 1) {
          drawCoverImage(
            ctx,
            loadedFrames[0],
            width,
            height,
            baseScale,
            panX,
            panY,
            talkTiltRad,
            1
          );
        } else {
          const cycleWave = (Math.sin(elapsed * 0.0065) + 1) / 2;
          const blendFactor =
            voiceEnergy > 0.35
              ? Math.min(1, cycleWave * 0.5 + 0.5)
              : cycleWave * 0.7;

          drawCoverImage(
            ctx,
            loadedFrames[0],
            width,
            height,
            baseScale,
            panX,
            panY,
            talkTiltRad,
            1
          );

          drawCoverImage(
            ctx,
            loadedFrames[1 % loadedFrames.length],
            width,
            height,
            baseScale * (1 + voiceEnergy * 0.012),
            panX * 0.9,
            panY * 1.1,
            -talkTiltRad * 0.7,
            blendFactor
          );
        }

        const grad = ctx.createLinearGradient(0, height * 0.58, 0, height);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.88)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, height * 0.58, width, height * 0.42);

        if (shotLabel) {
          ctx.save();
          const fontSize = Math.round(width * 0.026);
          ctx.font = `bold ${fontSize}px sans-serif`;
          const padX = 14;
          const textW = ctx.measureText(shotLabel).width;
          ctx.fillStyle = 'rgba(245, 158, 11, 0.92)';
          ctx.fillRect(20, 20, textW + padX * 2, fontSize + 14);
          ctx.fillStyle = '#09090b';
          ctx.fillText(shotLabel, 20 + padX, 20 + fontSize + 2);
          ctx.restore();
        }

        if (dialogueIta.trim()) {
          ctx.save();
          const subFontSize = Math.max(15, Math.round(width * 0.038));
          ctx.font = `bold ${subFontSize}px sans-serif`;
          ctx.textAlign = 'center';

          const lines = wrapText(ctx, `“${dialogueIta.trim()}”`, width * 0.84);
          const lineHeight = subFontSize * 1.32;
          const baseBottomY = height - Math.round(height * 0.07);

          if (speakerName) {
            const speakerFontSize = Math.max(12, Math.round(width * 0.028));
            ctx.font = `bold ${speakerFontSize}px sans-serif`;
            ctx.fillStyle = '#fbbf24';
            ctx.fillText(
              `🎙️ ${speakerName.toUpperCase()}`,
              width / 2,
              baseBottomY - lines.length * lineHeight - 10
            );
          }

          ctx.font = `bold ${subFontSize}px sans-serif`;
          lines.forEach((line, idx) => {
            const y = baseBottomY - (lines.length - 1 - idx) * lineHeight;
            ctx.strokeStyle = 'rgba(0,0,0,0.92)';
            ctx.lineWidth = 4;
            ctx.strokeText(line, width / 2, y);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(line, width / 2, y);
          });
          ctx.restore();
        }

        if (videoTrack && typeof videoTrack.requestFrame === 'function') {
          videoTrack.requestFrame();
        }

        if (elapsed >= totalMs) {
          clearInterval(timer);
          if (onProgress) onProgress(100);
          resolve();
        }
      }, 41);
    });

    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    const finalBlob = await stopPromise;
    return blobToDataUrl(finalBlob);
  } finally {
    if (canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
  }
}

/**
 * Unisce più segmenti video in un UNICO file video continuo.
 * Usa `videoEl.muted = true` + decodifica AudioBuffer separata così Chrome non blocca mai `videoEl.play()`!
 */
export async function stitchVideoClipsIntoSingleVideo(
  videoDataUrls: string[],
  aspectRatio: '9:16' | '16:9' = '9:16',
  compactForCloud = false
): Promise<string> {
  if (videoDataUrls.length === 0) {
    throw new Error('Nessuna clip video da unire.');
  }
  if (videoDataUrls.length === 1) {
    return videoDataUrls[0];
  }

  const width =
    aspectRatio === '9:16'
      ? compactForCloud
        ? 480
        : 720
      : compactForCloud
      ? 854
      : 1280;
  const height =
    aspectRatio === '9:16'
      ? compactForCloud
        ? 854
        : 1280
      : compactForCloud
      ? 480
      : 720;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'fixed';
  canvas.style.left = '-9999px';
  canvas.style.top = '0px';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.pointerEvents = 'none';
  canvas.style.opacity = '0.01';
  document.body.appendChild(canvas);

  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas non disponibile per il montaggio video.');

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);

    const audioCtx = unlockSharedAudioContext();
    let dest: MediaStreamAudioDestinationNode | null = null;
    if (audioCtx && audioCtx.state === 'running') {
      try {
        dest = audioCtx.createMediaStreamDestination();
      } catch {
        dest = null;
      }
    }

    const canvasStream = canvas.captureStream(24);
    const videoTrack = canvasStream.getVideoTracks()[0] as MediaStreamTrack & {
      requestFrame?: () => void;
    };

    const combinedTracks: MediaStreamTrack[] = [
      ...canvasStream.getVideoTracks(),
    ];
    if (dest && audioCtx && audioCtx.state === 'running') {
      combinedTracks.push(...dest.stream.getAudioTracks());
    }

    const combinedStream = new MediaStream(combinedTracks);
    const mimeType = pickSupportedVideoMimeType();
    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: compactForCloud ? 500_000 : 2_400_000,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const stopPromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    recorder.start(100);

    for (const clipUrl of videoDataUrls) {
      // Riproduce eventuale audio decodificato direttamente nell'AudioContext sbloccato
      if (audioCtx && audioCtx.state === 'running' && dest) {
        try {
          const r = await fetch(clipUrl);
          const ab = await r.arrayBuffer();
          const decoded = await audioCtx.decodeAudioData(ab);
          const srcNode = audioCtx.createBufferSource();
          srcNode.buffer = decoded;
          srcNode.connect(dest);
          srcNode.start(0);
        } catch {
          // Se il browser non decodifica l'audio dal container WebM ignoriamo senza bloccare il video
        }
      }

      await new Promise<void>((resolve) => {
        const videoEl = document.createElement('video');
        videoEl.src = clipUrl;
        videoEl.crossOrigin = 'anonymous';
        videoEl.playsInline = true;
        // IMPORTANTE: muted = true permette SEMPRE a Chrome di riprodurre il video senza errore NotAllowedError!
        videoEl.muted = true;

        let timerId: ReturnType<typeof setInterval> | null = null;

        videoEl.onplay = () => {
          timerId = setInterval(() => {
            if (!videoEl.paused && !videoEl.ended) {
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, width, height);
              ctx.drawImage(videoEl, 0, 0, width, height);
              if (videoTrack && typeof videoTrack.requestFrame === 'function') {
                videoTrack.requestFrame();
              }
            }
          }, 41);
        };

        videoEl.onended = () => {
          if (timerId) clearInterval(timerId);
          resolve();
        };

        videoEl.onerror = () => {
          if (timerId) clearInterval(timerId);
          resolve();
        };

        videoEl.play().catch(() => {
          if (timerId) clearInterval(timerId);
          resolve();
        });
      });
    }

    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    const mergedBlob = await stopPromise;
    if (mergedBlob.size < 5000) {
      return videoDataUrls[0];
    }
    return blobToDataUrl(mergedBlob);
  } finally {
    if (canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
  }
}
