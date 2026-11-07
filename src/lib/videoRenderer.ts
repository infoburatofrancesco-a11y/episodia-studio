export interface RenderShotVideoParams {
  frameImageBase64: string;
  framesBase64?: string[];
  isGrid2x2?: boolean;
  aiVideoDataUrl?: string | null;
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

/**
 * Comprime un'immagine Base64 in un JPEG leggero (~35KB) prima di inviarla all'API su Vercel,
 * dimezzando i tempi di risposta di Nano Banana ed evitando qualsiasi timeout 504!
 */
export async function compressImageForApi(
  dataUrl: string,
  maxDim = 512
): Promise<string> {
  if (!dataUrl || typeof window === 'undefined') return dataUrl;
  try {
    const img = await loadImage(dataUrl);
    let w = img.width || 512;
    let h = img.height || 512;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.78);
  } catch {
    return dataUrl;
  }
}

/**
 * Rimuove eventuali parametri ";codecs=vp8,opus" dal prefisso Data URL
 * perché la virgola dentro "vp8,opus" prima di ";base64," rompe il parser RFC 2397 di Chrome nei tag <video>,
 * facendo apparire il video grigio con durata 0:00!
 */
// Cache in memoria dei Blob URL generati dai Data URL Base64 così i tag <video>
// usano sempre "blob:https://..." (senza il limite di 2MB dei data: URL di Chrome che causa "Impossibile accedere al file"!)
const blobUrlCache = new Map<string, string>();

export function dataUrlToVideoBlob(videoDataUrl: string): Blob | null {
  if (!videoDataUrl) return null;
  try {
    const idx = videoDataUrl.indexOf(';base64,');
    const rawBase64 =
      idx >= 0 ? videoDataUrl.slice(idx + 8).trim() : videoDataUrl.trim();
    const binaryStr = atob(rawBase64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    // Riconosce automaticamente dai magic bytes se è un WebM (0x1A 0x45 0xDF 0xA3) o un MP4 (ftyp)
    const isWebmMagic =
      len >= 4 &&
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3;
    const mime = isWebmMagic ? 'video/webm' : 'video/mp4';
    return new Blob([bytes], { type: mime });
  } catch (err) {
    console.error('Errore conversione DataURL in Blob video:', err);
    return null;
  }
}

/**
 * Converte qualsiasi Data URL video in un Blob URL ("blob:https://...") pronto per il tag <video> e per il menu "Scarica" nativo di Chrome,
 * superando il limite di 2MB sui data: URL di Chrome che causava l'errore "Impossibile accedere al file"!
 */
export function normalizeVideoDataUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('blob:') || url.startsWith('http')) {
    return url;
  }
  if (typeof window === 'undefined') {
    const idx = url.indexOf(';base64,');
    if (idx >= 0) {
      const rawBase64 = url.slice(idx + 8);
      const isMp4 = url.slice(0, idx).includes('video/mp4');
      return `data:${isMp4 ? 'video/mp4' : 'video/webm'};base64,${rawBase64}`;
    }
    return url;
  }

  const cacheKey = `${url.length}:${url.slice(0, 48)}:${url.slice(-48)}`;
  const cached = blobUrlCache.get(cacheKey);
  if (cached) return cached;

  const blob = dataUrlToVideoBlob(url);
  if (blob) {
    const objectUrl = URL.createObjectURL(blob);
    blobUrlCache.set(cacheKey, objectUrl);
    return objectUrl;
  }

  return url;
}

/**
 * Converte qualsiasi Data URL o Blob URL video in un vero file binario (.mp4 o .webm) e avvia il download.
 */
export function downloadVideoDataUrlAsBinaryFile(
  videoDataUrl: string,
  filename: string
): void {
  if (!videoDataUrl) return;
  try {
    if (videoDataUrl.startsWith('blob:')) {
      const a = document.createElement('a');
      a.href = videoDataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    const blob = dataUrlToVideoBlob(videoDataUrl);
    if (!blob) return;
    const ext = blob.type === 'video/mp4' ? '.mp4' : '.webm';
    const cleanFilename = filename.replace(/\.(webm|mp4)$/i, '') + ext;
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = cleanFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
  } catch (err) {
    console.error('Errore download binario video:', err);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  const cleanType = (blob.type || 'video/mp4').split(';')[0] || 'video/mp4';
  const cleanBlob = new Blob([blob], { type: cleanType });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const res = reader.result;
        const idx = res.indexOf(';base64,');
        if (idx >= 0) {
          resolve(`data:${cleanType};base64,${res.slice(idx + 8)}`);
        } else {
          resolve(res);
        }
      } else {
        reject(new Error('Conversione video Base64 fallita.'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(cleanBlob);
  });
}

function pickSupportedVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'video/mp4';
  // Preferiamo SEMPRE MP4 (H.264/AAC) supportato nativamente da Chrome moderno, Windows Media Player, iPhone e Android!
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
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

function drawCoverSource(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLCanvasElement,
  srcW: number,
  srcH: number,
  width: number,
  height: number,
  scale: number,
  panX: number,
  panY: number,
  rotationRad: number,
  alpha = 1
) {
  const imgRatio = srcW / srcH;
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
  ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
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
  drawCoverSource(
    ctx,
    img,
    img.width,
    img.height,
    width,
    height,
    scale,
    panX,
    panY,
    rotationRad,
    alpha
  );
}

/**
 * Taglia una Griglia 2x2 (4 pannelli sequenziali: Top-Left, Top-Right, Bottom-Left, Bottom-Right)
 * in 4 Canvas a piena risoluzione (width x height), ritagliando un margine interno del 2%
 * per eliminare qualsiasi eventuale linea di giunzione tra i quadranti.
 */
function sliceGrid2x2IntoQuadrants(
  gridImg: HTMLImageElement,
  width: number,
  height: number,
  isGrid = true
): HTMLCanvasElement[] {
  if (!isGrid) {
    const singleCanvas = document.createElement('canvas');
    singleCanvas.width = width;
    singleCanvas.height = height;
    const sCtx = singleCanvas.getContext('2d');
    if (sCtx) {
      drawCoverImage(sCtx, gridImg, width, height, 1, 0, 0, 0, 1);
    }
    return [singleCanvas, singleCanvas, singleCanvas, singleCanvas];
  }

  const halfW = gridImg.width / 2;
  const halfH = gridImg.height / 2;
  const padX = Math.round(halfW * 0.02);
  const padY = Math.round(halfH * 0.02);
  const cropW = Math.max(16, halfW - padX * 2);
  const cropH = Math.max(16, halfH - padY * 2);

  const coords = [
    { sx: padX, sy: padY }, // Beat 0: Top-Left
    { sx: halfW + padX, sy: padY }, // Beat 1: Top-Right
    { sx: padX, sy: halfH + padY }, // Beat 2: Bottom-Left
    { sx: halfW + padX, sy: halfH + padY }, // Beat 3: Bottom-Right
  ];

  return coords.map(({ sx, sy }) => {
    const qCanvas = document.createElement('canvas');
    qCanvas.width = width;
    qCanvas.height = height;
    const qCtx = qCanvas.getContext('2d');
    if (!qCtx) return qCanvas;

    const srcRatio = cropW / cropH;
    const dstRatio = width / height;
    let drawW = width;
    let drawH = height;
    if (srcRatio > dstRatio) {
      drawH = height;
      drawW = height * srcRatio;
    } else {
      drawW = width;
      drawH = width / srcRatio;
    }
    const dx = (width - drawW) / 2;
    const dy = (height - drawH) / 2;
    qCtx.drawImage(gridImg, sx, sy, cropW, cropH, dx, dy, drawW, drawH);
    return qCanvas;
  });
}

interface AlignedMouthPatchResult {
  patchCanvas: HTMLCanvasElement;
  normCx: number;
  normCy: number;
}

/**
 * Confronta il quadrante base (bocca chiusa) e il quadrante variante (bocca aperta/semi-aperta),
 * cerca il centro esatto della bocca SOLO nella zona volto (evitando le mani nella metà inferiore),
 * allinea automaticamente al pixel il volto (dx, dy) e crea una maschera ellittica sfumata sulla bocca/mascella.
 */
function buildAlignedMouthPatch(
  baseQuad: HTMLCanvasElement,
  variantQuad: HTMLCanvasElement,
  width: number,
  height: number
): AlignedMouthPatchResult {
  const gridW = 180;
  const gridH = Math.round((height / width) * gridW);

  const c0 = document.createElement('canvas');
  c0.width = gridW;
  c0.height = gridH;
  const ctx0 = c0.getContext('2d');

  const c1 = document.createElement('canvas');
  c1.width = gridW;
  c1.height = gridH;
  const ctx1 = c1.getContext('2d');

  let normCx = 0.5;
  let normCy = 0.36;
  let bestDx = 0;
  let bestDy = 0;

  if (ctx0 && ctx1) {
    ctx0.drawImage(baseQuad, 0, 0, gridW, gridH);
    ctx1.drawImage(variantQuad, 0, 0, gridW, gridH);

    const d0 = ctx0.getImageData(0, 0, gridW, gridH).data;
    const d1 = ctx1.getImageData(0, 0, gridW, gridH).data;

    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;

    // Cerchiamo la bocca SOLO nella fascia volto (18% - 54% verticale) così eventuali movimenti
    // delle mani nella parte bassa non spostano mai la maschera labiale verso il petto!
    const minY = Math.floor(gridH * 0.18);
    const maxY = Math.floor(gridH * 0.54);
    const minX = Math.floor(gridW * 0.12);
    const maxX = Math.floor(gridW * 0.88);

    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const idx = (y * gridW + x) * 4;
        const diff =
          Math.abs(d1[idx] - d0[idx]) +
          Math.abs(d1[idx + 1] - d0[idx + 1]) +
          Math.abs(d1[idx + 2] - d0[idx + 2]);
        if (diff > 36) {
          const w = (diff - 36) * (diff - 36);
          weightedX += x * w;
          weightedY += y * w;
          totalWeight += w;
        }
      }
    }

    if (totalWeight > 350) {
      normCx = Math.min(0.82, Math.max(0.18, weightedX / totalWeight / gridW));
      normCy = Math.min(0.52, Math.max(0.22, weightedY / totalWeight / gridH));
    }

    // Allineamento automatico (dx, dy) sulla zona occhi/naso sopra la bocca per eliminare qualsiasi micro-shift della testa
    const anchorX0 = Math.max(8, Math.floor((normCx - 0.1) * gridW));
    const anchorX1 = Math.min(gridW - 8, Math.floor((normCx + 0.1) * gridW));
    const anchorY0 = Math.max(8, Math.floor((normCy - 0.12) * gridH));
    const anchorY1 = Math.min(gridH - 8, Math.floor((normCy - 0.03) * gridH));

    let minAnchorErr = Number.POSITIVE_INFINITY;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        let err = 0;
        for (let y = anchorY0; y < anchorY1; y += 2) {
          for (let x = anchorX0; x < anchorX1; x += 2) {
            const i0 = (y * gridW + x) * 4;
            const i1 = ((y + dy) * gridW + (x + dx)) * 4;
            err +=
              Math.abs(d0[i0] - d1[i1]) +
              Math.abs(d0[i0 + 1] - d1[i1 + 1]) +
              Math.abs(d0[i0 + 2] - d1[i1 + 2]);
          }
        }
        // Leggera preferenza per shift (0,0) a parità di errore
        const penalty = (Math.abs(dx) + Math.abs(dy)) * 18;
        if (err + penalty < minAnchorErr) {
          minAnchorErr = err + penalty;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
  }

  const patchCanvas = document.createElement('canvas');
  patchCanvas.width = width;
  patchCanvas.height = height;
  const pCtx = patchCanvas.getContext('2d');
  if (!pCtx) return { patchCanvas, normCx, normCy };

  const shiftPxX = -bestDx * (width / gridW);
  const shiftPxY = -bestDy * (height / gridH);
  pCtx.drawImage(variantQuad, shiftPxX, shiftPxY, width, height);

  const cx = normCx * width;
  const cy = normCy * height;
  const rx = width * 0.16;
  const ry = height * 0.095;

  pCtx.save();
  pCtx.globalCompositeOperation = 'destination-in';
  pCtx.translate(cx, cy);
  pCtx.scale(rx, ry);
  const radGrad = pCtx.createRadialGradient(0, 0, 0.35, 0, 0, 1.0);
  radGrad.addColorStop(0, 'rgba(0,0,0,1)');
  radGrad.addColorStop(0.65, 'rgba(0,0,0,0.92)');
  radGrad.addColorStop(1, 'rgba(0,0,0,0)');
  pCtx.fillStyle = radGrad;
  pCtx.fillRect(-1.2, -1.2, 2.4, 2.4);
  pCtx.restore();

  return { patchCanvas, normCx, normCy };
}

/**
 * Individua i 3 punti ideali di cambio posa (attorno al 25%, 50%, 75% della clip)
 * agganciandoli alle pause naturali del parlato italiano nel buffer PCM.
 */
function findSpeechBeatBoundaries(
  pcmData: Float32Array | null,
  sampleRate: number,
  totalMs: number
): [number, number, number] {
  const defaultBounds: [number, number, number] = [
    totalMs * 0.25,
    totalMs * 0.5,
    totalMs * 0.75,
  ];
  if (!pcmData || pcmData.length === 0) return defaultBounds;

  const winSamples = Math.max(1, Math.floor(0.06 * sampleRate));
  const stepMs = 40;

  return defaultBounds.map((nominalMs) => {
    let bestMs = nominalMs;
    let minRms = Number.POSITIVE_INFINITY;
    for (let offset = -380; offset <= 380; offset += stepMs) {
      const candidateMs = nominalMs + offset;
      const startIdx = Math.floor((candidateMs / 1000) * sampleRate);
      if (startIdx < 0 || startIdx + winSamples >= pcmData.length) continue;
      let sumSq = 0;
      for (let i = startIdx; i < startIdx + winSamples; i += 4) {
        const s = pcmData[i];
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / (winSamples / 4));
      if (rms < minRms) {
        minRms = rms;
        bestMs = candidateMs;
      }
    }
    return bestMs;
  }) as [number, number, number];
}

function drawCoverVideo(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement,
  width: number,
  height: number
) {
  const vw = videoEl.videoWidth || width;
  const vh = videoEl.videoHeight || height;
  const vidRatio = vw / vh;
  const canvasRatio = width / height;
  let drawW = width;
  let drawH = height;
  if (vidRatio > canvasRatio) {
    drawH = height;
    drawW = height * vidRatio;
  } else {
    drawW = width;
    drawH = width / vidRatio;
  }

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.drawImage(videoEl, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

/**
 * Renderizza un singolo Shot di 10s unendo il vero video AI 24fps (aiVideoDataUrl)
 * oppure la Griglia 2x2 a 4 Pose Fisiche Consecutive + Lip-Sync 30fps con la voce italiana.
 */
export async function renderShotVideoDataUrl(
  params: RenderShotVideoParams
): Promise<string> {
  const {
    frameImageBase64,
    framesBase64 = [],
    isGrid2x2 = true,
    aiVideoDataUrl,
    audioWavBase64,
    dialogueIta = '',
    speakerName = '',
    shotLabel = '',
    durationSeconds = 10,
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

    // Se è stato generato il vero video AI 24fps (aiVideoDataUrl), lo carichiamo in un elemento <video>
    let aiVideoEl: HTMLVideoElement | null = null;
    if (aiVideoDataUrl) {
      try {
        const vEl = document.createElement('video');
        vEl.src = normalizeVideoDataUrl(aiVideoDataUrl);
        vEl.muted = true;
        vEl.loop = true;
        vEl.playsInline = true;
        vEl.crossOrigin = 'anonymous';
        await new Promise<void>((resVid) => {
          const timeoutId = setTimeout(() => resVid(), 4000);
          vEl.onloadeddata = () => {
            clearTimeout(timeoutId);
            resVid();
          };
          vEl.onerror = () => {
            clearTimeout(timeoutId);
            resVid();
          };
          vEl.load();
        });
        if (vEl.videoWidth > 0) {
          vEl.playbackRate = 1.0;
          await vEl.play().catch(() => {});
          aiVideoEl = vEl;
        }
      } catch (vErr) {
        console.warn('Fallback da aiVideoEl a frame:', vErr);
      }
    }

    // Estraiamo i 4 Quadranti Sequenziali (Beat 0..3) dalla Griglia 2x2 Base (bocca chiusa)
    // e dalle Griglie 2x2 Varianti (bocca aperta "Ah" e bocca semi-aperta "Oh"/"Eh")
    const closedQuads = sliceGrid2x2IntoQuadrants(
      loadedFrames[0],
      width,
      height,
      isGrid2x2
    );
    const openQuads =
      loadedFrames.length > 1
        ? sliceGrid2x2IntoQuadrants(loadedFrames[1], width, height, isGrid2x2)
        : closedQuads;
    const midQuads =
      loadedFrames.length > 2
        ? sliceGrid2x2IntoQuadrants(loadedFrames[2], width, height, isGrid2x2)
        : openQuads;

    // Per ciascuna delle 4 pose fisiche (Beat 0..3), costruiamo la maschera labiale allineata al pixel
    const beatsData = [0, 1, 2, 3].map((b) => {
      const openPatch =
        loadedFrames.length > 1
          ? buildAlignedMouthPatch(closedQuads[b], openQuads[b], width, height)
          : null;
      const midPatch =
        loadedFrames.length > 2
          ? buildAlignedMouthPatch(closedQuads[b], midQuads[b], width, height)
          : openPatch;
      return {
        closedCanvas: closedQuads[b],
        openPatchCanvas: openPatch?.patchCanvas || null,
        midPatchCanvas: midPatch?.patchCanvas || null,
        normCx: openPatch?.normCx ?? 0.5,
        normCy: openPatch?.normCy ?? 0.36,
      };
    });

    // Canvas offscreen per sfumare dolcemente i cambi di posa del corpo (Beat b -> Beat b+1)
    const beatBufferA = document.createElement('canvas');
    beatBufferA.width = width;
    beatBufferA.height = height;
    const ctxBufA = beatBufferA.getContext('2d');

    const beatBufferB = document.createElement('canvas');
    beatBufferB.width = width;
    beatBufferB.height = height;
    const ctxBufB = beatBufferB.getContext('2d');

    const renderSingleBeatPoseWithLips = (
      targetCtx: CanvasRenderingContext2D,
      beatIdx: number,
      sOpen: number,
      sMid: number,
      scale: number,
      pX: number,
      pY: number,
      tRad: number
    ) => {
      const bData = beatsData[Math.min(3, Math.max(0, beatIdx))];
      // 1. Disegna la posa fisica completa del Beat (braccia, mani, testa, sfondo 1:1) a bocca chiusa
      drawCoverSource(
        targetCtx,
        bData.closedCanvas,
        width,
        height,
        width,
        height,
        scale,
        pX,
        pY,
        tRad,
        1
      );
      // 2. Sovrappone a 30fps la maschera labiale semi-aperta ("Oh"/"Eh")
      if (bData.midPatchCanvas && sMid > 0.015) {
        drawCoverSource(
          targetCtx,
          bData.midPatchCanvas,
          width,
          height,
          width,
          height,
          scale,
          pX,
          pY,
          tRad,
          Math.min(1, sMid)
        );
      }
      // 3. Sovrappone a 30fps la maschera labiale aperta ("Ah")
      if (bData.openPatchCanvas && sOpen > 0.015) {
        drawCoverSource(
          targetCtx,
          bData.openPatchCanvas,
          width,
          height,
          width,
          height,
          scale,
          pX,
          pY,
          tRad,
          Math.min(1, sOpen * 1.1)
        );
      }
    };

    // Disegna subito il primo fotogramma (Beat 0) prima di far partire MediaRecorder
    if (aiVideoEl) {
      drawCoverVideo(ctx, aiVideoEl, width, height);
    } else {
      drawCoverSource(
        ctx,
        beatsData[0].closedCanvas,
        width,
        height,
        width,
        height,
        1.015,
        0,
        0,
        0,
        1
      );
    }

    const audioCtx = unlockSharedAudioContext();
    let dest: MediaStreamAudioDestinationNode | null = null;
    let analyser: AnalyserNode | null = null;
    let timeData: Uint8Array | null = null;
    let audioBuffer: AudioBuffer | null = null;

    if (audioCtx && audioCtx.state === 'running') {
      try {
        dest = audioCtx.createMediaStreamDestination();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        timeData = new Uint8Array(analyser.fftSize);

        if (audioWavBase64) {
          const res = await fetch(audioWavBase64);
          const arrayBuf = await res.arrayBuffer();
          audioBuffer = await audioCtx.decodeAudioData(arrayBuf);
        }
      } catch (e) {
        console.warn('Audio setup fallback:', e);
      }
    }

    // Estraiamo i campioni PCM esatti del canale audio per sincronizzare le labbra al millisecondo (latenza ZERO!)
    const pcmChannelData = audioBuffer ? audioBuffer.getChannelData(0) : null;
    const pcmSampleRate = audioBuffer ? audioBuffer.sampleRate : 24000;

    const canvasStream = canvas.captureStream(30);
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
      videoBitsPerSecond: compactForCloud ? 500_000 : 2_600_000,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    const stopPromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        if (aiVideoEl) {
          aiVideoEl.pause();
          aiVideoEl.removeAttribute('src');
        }
        const cleanMime = mimeType.split(';')[0] || 'video/webm';
        resolve(new Blob(chunks, { type: cleanMime }));
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
    const audioDurationMs = audioBuffer
      ? audioBuffer.duration * 1000
      : dialogueIta.trim()
      ? totalMs * 0.75
      : 0;

    // Punti di transizione tra le 4 pose fisiche (Beat 0 -> Beat 1 -> Beat 2 -> Beat 3) agganciati alle pause del parlato
    const beatBounds = findSpeechBeatBoundaries(
      pcmChannelData,
      pcmSampleRate,
      totalMs
    );
    const transitionHalfWindowMs = 210; // dissolvenza incrociata morbida di 420ms totali tra una posa e la successiva

    let smoothOpen = 0;
    let smoothMid = 0;
    let smoothVoiceEnergy = 0;

    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(1, elapsed / totalMs);
        if (onProgress) {
          onProgress(Math.min(99, Math.round(progress * 100)));
        }

        const isWithinSpeechWindow = elapsed < audioDurationMs;
        let rmsEnergy = 0;
        let zeroCrossRate = 0.1;

        if (pcmChannelData && isWithinSpeechWindow) {
          // Lettura diretta a latenza zero dai campioni PCM della voce italiana all'istante esatto `elapsed`
          const startSample = Math.floor((elapsed / 1000) * pcmSampleRate);
          const windowSamples = Math.floor(0.042 * pcmSampleRate); // finestra sillabica di 42ms
          const endSample = Math.min(
            pcmChannelData.length,
            startSample + windowSamples
          );
          if (endSample > startSample) {
            let sumSq = 0;
            let zc = 0;
            let prev = pcmChannelData[startSample];
            for (let i = startSample; i < endSample; i++) {
              const s = pcmChannelData[i];
              sumSq += s * s;
              if ((s >= 0 && prev < 0) || (s < 0 && prev >= 0)) {
                zc++;
              }
              prev = s;
            }
            const count = endSample - startSample;
            rmsEnergy = Math.sqrt(sumSq / count);
            zeroCrossRate = zc / count;
          }
        } else if (analyser && timeData && isWithinSpeechWindow) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          analyser.getByteTimeDomainData(timeData as any);
          let sumSq = 0;
          for (let i = 0; i < timeData.length; i++) {
            const norm = (timeData[i] - 128) / 128;
            sumSq += norm * norm;
          }
          rmsEnergy = Math.sqrt(sumSq / timeData.length);
        }

        // Soglia silenzio: durante le pause tra le parole o a fine frase la bocca si chiude immediatamente!
        let targetOpen = 0;
        let targetMid = 0;
        const isSpeakingNow = isWithinSpeechWindow && rmsEnergy >= 0.011;

        if (isSpeakingNow) {
          const normVol = Math.min(1, (rmsEnergy - 0.011) / 0.12);
          // Articolazione sillabica naturale (~7Hz) sincronizzata con l'energia vocale e le vocali italiane
          const syllablePulse = 0.74 + 0.26 * Math.sin(elapsed * 0.046);
          if (normVol > 0.34 && zeroCrossRate < 0.21) {
            // Vocale aperta ("A", "O", "E" forte) -> visema bocca aperta
            targetOpen = Math.min(1, normVol * 1.25 * syllablePulse);
            targetMid = Math.max(0, (1 - targetOpen) * 0.45);
          } else {
            // Sillaba media / consonante ("I", "U", "M", "S") -> visema bocca semi-aperta
            targetMid = Math.min(1, normVol * 1.3 * syllablePulse);
            targetOpen = Math.max(0, (normVol - 0.25) * 0.7);
          }
        }

        // Filtro esponenziale asimmetrico a 30fps: apertura rapida su attacco sillaba, chiusura morbida su pausa
        smoothOpen +=
          (targetOpen - smoothOpen) * (targetOpen > smoothOpen ? 0.68 : 0.48);
        smoothMid +=
          (targetMid - smoothMid) * (targetMid > smoothMid ? 0.68 : 0.48);
        if (smoothOpen < 0.015) smoothOpen = 0;
        if (smoothMid < 0.015) smoothMid = 0;

        const rawVoiceEnergy = isSpeakingNow
          ? Math.min(1, rmsEnergy * 6.5)
          : 0;
        smoothVoiceEnergy += (rawVoiceEnergy - smoothVoiceEnergy) * 0.32;

        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 0, width, height);

        if (aiVideoEl && aiVideoEl.videoWidth > 0) {
          if (isWithinSpeechWindow) {
            if (isSpeakingNow) {
              aiVideoEl.playbackRate = 1.15 + smoothVoiceEnergy * 0.18;
              if (aiVideoEl.paused) {
                aiVideoEl.play().catch(() => {});
              }
            } else {
              aiVideoEl.playbackRate = 0.25;
            }
            drawCoverVideo(ctx, aiVideoEl, width, height);
          } else {
            if (!aiVideoEl.paused) {
              aiVideoEl.pause();
            }
            drawCoverVideo(ctx, aiVideoEl, width, height);
            const postSpeechFade = Math.min(
              1,
              Math.max(0, (elapsed - audioDurationMs) / 450)
            );
            if (postSpeechFade > 0.02) {
              drawCoverSource(
                ctx,
                beatsData[3].closedCanvas,
                width,
                height,
                width,
                height,
                1.01,
                0,
                0,
                0,
                postSpeechFade
              );
            }
          }
        } else {
          // Respiro naturale della camera + leggero accento enfatico sincronizzato con l'energia della voce
          const baseScale =
            1.015 + progress * 0.02 + smoothVoiceEnergy * 0.006;
          const panX = Math.sin(progress * Math.PI * 2) * (width * 0.006);
          const panY = -smoothVoiceEnergy * (height * 0.003);
          const tiltRad = 0;

          // Determina in quale dei 4 Beat fisici (0..3) ci troviamo e se siamo in transizione morbida tra due pose
          let primaryBeat = 0;
          if (elapsed >= beatBounds[2]) {
            primaryBeat = 3;
          } else if (elapsed >= beatBounds[1]) {
            primaryBeat = 2;
          } else if (elapsed >= beatBounds[0]) {
            primaryBeat = 1;
          }

          let transitionFromBeat = -1;
          let transitionToBeat = -1;
          let transitionBlend = 0;

          for (let b = 0; b < 3; b++) {
            const dist = elapsed - beatBounds[b];
            if (Math.abs(dist) <= transitionHalfWindowMs) {
              transitionFromBeat = b;
              transitionToBeat = b + 1;
              const rawT =
                (dist + transitionHalfWindowMs) / (transitionHalfWindowMs * 2);
              // Curva cubic ease-in-out per un cambio gesto fluido e naturale
              transitionBlend = rawT * rawT * (3 - 2 * rawT);
              break;
            }
          }

          if (
            transitionFromBeat >= 0 &&
            transitionToBeat >= 0 &&
            ctxBufA &&
            ctxBufB
          ) {
            ctxBufA.clearRect(0, 0, width, height);
            ctxBufB.clearRect(0, 0, width, height);
            renderSingleBeatPoseWithLips(
              ctxBufA,
              transitionFromBeat,
              smoothOpen,
              smoothMid,
              baseScale,
              panX,
              panY,
              tiltRad
            );
            renderSingleBeatPoseWithLips(
              ctxBufB,
              transitionToBeat,
              smoothOpen,
              smoothMid,
              baseScale,
              panX,
              panY,
              tiltRad
            );
            ctx.drawImage(beatBufferA, 0, 0);
            ctx.save();
            ctx.globalAlpha = transitionBlend;
            ctx.drawImage(beatBufferB, 0, 0);
            ctx.restore();
          } else {
            renderSingleBeatPoseWithLips(
              ctx,
              primaryBeat,
              smoothOpen,
              smoothMid,
              baseScale,
              panX,
              panY,
              tiltRad
            );
          }
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
      }, 33);
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
      const cleanMime = mimeType.split(';')[0] || 'video/webm';
      recorder.onstop = () => resolve(new Blob(chunks, { type: cleanMime }));
    });

    recorder.start(100);

    for (const rawClipUrl of videoDataUrls) {
      const clipUrl = normalizeVideoDataUrl(rawClipUrl);
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
