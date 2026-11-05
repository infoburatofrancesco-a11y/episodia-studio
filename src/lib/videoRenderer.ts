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
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
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
 * Renderizza un singolo Shot animando i fotogrammi d'azione multipli generati da Nano Banana (`framesBase64`)
 * sincronizzati con la voce recitata italiana (`AnalyserNode` + lip/body motion reattivo all'audio).
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

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Impossibile inizializzare il motore grafico Canvas.');

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

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const audioCtx = new AudioCtx();
  const dest = audioCtx.createMediaStreamDestination();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  let audioBuffer: AudioBuffer | null = null;
  if (audioWavBase64) {
    try {
      const res = await fetch(audioWavBase64);
      const arrayBuf = await res.arrayBuffer();
      audioBuffer = await audioCtx.decodeAudioData(arrayBuf);
    } catch (e) {
      console.warn('Audio decode fallback:', e);
    }
  }

  const canvasStream = canvas.captureStream(24);
  const combinedTracks = [
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ];
  const combinedStream = new MediaStream(combinedTracks);

  const mimeType = pickSupportedVideoMimeType();
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: compactForCloud ? 450_000 : 2_400_000,
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

  if (audioBuffer) {
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
    osc.stop(durationSeconds);
  }

  const startTime = performance.now();
  const totalMs = durationSeconds * 1000;

  await new Promise<void>((resolve) => {
    const renderFrame = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / totalMs);

      // Calcolo energia vocale istantanea per muovere il personaggio a tempo col parlato
      analyser.getByteFrequencyData(freqData);
      let sum = 0;
      for (let i = 0; i < 24; i++) {
        sum += freqData[i];
      }
      const voiceEnergy = Math.min(1, sum / (24 * 170));

      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, width, height);

      // Movimento fisico reattivo alla voce + ciclo tra le pose d'azione Nano Banana
      const talkBounceY =
        Math.sin(elapsed * 0.022) * (height * 0.008 * (0.3 + voiceEnergy * 1.4));
      const talkTiltRad =
        Math.sin(elapsed * 0.011) * (0.012 * (0.4 + voiceEnergy));
      const baseScale = 1.03 + progress * 0.06 + voiceEnergy * 0.025;
      const panX = Math.sin(progress * Math.PI * 1.5) * (width * 0.018);
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
        // Alterna dinamicamente le pose Nano Banana (es. Posa 1 inizio, Posa 2 parlato attivo/gesto, Posa 3 reazione)
        // sincronizzandole anche con i picchi della voce!
        const numFrames = loadedFrames.length;
        const timelinePos = progress * (numFrames - 0.01);
        const primaryIdx = Math.min(numFrames - 1, Math.floor(timelinePos));
        const nextIdx = Math.min(numFrames - 1, primaryIdx + 1);
        const localFrac = timelinePos - primaryIdx;

        // Crossfade rapido sugli snodi d'azione + switch sul frame di parlato quando la voce è forte
        const activePoseIdx =
          voiceEnergy > 0.38 && numFrames >= 2 ? 1 : primaryIdx;

        drawCoverImage(
          ctx,
          loadedFrames[activePoseIdx],
          width,
          height,
          baseScale,
          panX,
          panY,
          talkTiltRad,
          1
        );

        // Transizione fluida tra una posa Nano Banana e la successiva
        if (localFrac > 0.72 && nextIdx !== activePoseIdx) {
          const blendAlpha = (localFrac - 0.72) / 0.28;
          drawCoverImage(
            ctx,
            loadedFrames[nextIdx],
            width,
            height,
            baseScale,
            panX,
            panY,
            talkTiltRad * 0.8,
            blendAlpha
          );
        }
      }

      // Gradiente cinematografico inferiore per sottotitoli nitidi
      const grad = ctx.createLinearGradient(0, height * 0.58, 0, height);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.88)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, height * 0.58, width, height * 0.42);

      // Badge superiore
      if (shotLabel) {
        ctx.save();
        const fontSize = Math.round(width * 0.026);
        ctx.font = `bold ${fontSize}px sans-serif`;
        const padX = 14;
        const textW = ctx.measureText(shotLabel).width;
        ctx.fillStyle = 'rgba(245, 158, 11, 0.92)';
        ctx.beginPath();
        ctx.roundRect(20, 20, textW + padX * 2, fontSize + 14, 8);
        ctx.fill();
        ctx.fillStyle = '#09090b';
        ctx.fillText(shotLabel, 20 + padX, 20 + fontSize + 2);
        ctx.restore();
      }

      // Sottotitolo e Speaker in basso con indicatore vocale dinamico
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
          ctx.font = `extrabold ${speakerFontSize}px sans-serif`;
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

      if (elapsed < totalMs) {
        requestAnimationFrame(renderFrame);
      } else {
        resolve();
      }
    };

    requestAnimationFrame(renderFrame);
  });

  recorder.stop();
  const finalBlob = await stopPromise;
  await audioCtx.close().catch(() => {});
  return blobToDataUrl(finalBlob);
}

/**
 * Unisce più segmenti (es. i 1-3 shot della Sigla oppure la Sigla Cloud + gli Shot della puntata)
 * in un UNICO file video continuo!
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
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas non disponibile per il montaggio video.');

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const audioCtx = new AudioCtx();
  const dest = audioCtx.createMediaStreamDestination();

  const canvasStream = canvas.captureStream(24);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = pickSupportedVideoMimeType();
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: compactForCloud ? 450_000 : 2_400_000,
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
    await new Promise<void>((resolve) => {
      const videoEl = document.createElement('video');
      videoEl.src = clipUrl;
      videoEl.crossOrigin = 'anonymous';
      videoEl.playsInline = true;
      videoEl.muted = false;

      let rafId = 0;
      try {
        const mediaElemSource = audioCtx.createMediaElementSource(videoEl);
        mediaElemSource.connect(dest);
      } catch {
        // Se la clip non ha traccia audio compatibile proseguiamo col video
      }

      const drawLoop = () => {
        if (!videoEl.paused && !videoEl.ended) {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(videoEl, 0, 0, width, height);
          rafId = requestAnimationFrame(drawLoop);
        }
      };

      videoEl.onplay = () => {
        drawLoop();
      };

      videoEl.onended = () => {
        cancelAnimationFrame(rafId);
        resolve();
      };

      videoEl.onerror = () => {
        cancelAnimationFrame(rafId);
        resolve();
      };

      videoEl.play().catch(() => resolve());
    });
  }

  recorder.stop();
  const mergedBlob = await stopPromise;
  await audioCtx.close().catch(() => {});
  return blobToDataUrl(mergedBlob);
}
