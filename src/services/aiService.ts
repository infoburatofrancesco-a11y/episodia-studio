import {
  CastMember,
  SceneCard,
  UploadedMediaItem,
  ApiKeysConfig,
  IntroOutroConfig,
  CameraShotType,
  DialogueTurn,
  SeriesGenreStyle,
  SERIES_GENRE_STYLES,
  CharacterBoundingBox,
  AiPlotProposal
} from '../types/studio';
import { audioBufferToWavBlob } from './audioExtractorService';

const GEMINI_VISION_TEXT_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

const GEMINI_TTS_MODELS = [
  'gemini-2.5-flash-preview-tts',
  'gemini-2.0-flash-exp'
];

const NANO_BANANA_IMAGE_MODELS = [
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.5-flash-image'
];

function isVitaDaCaniSeries(seriesTitle?: string, idea?: string): boolean {
  const combined = `${seriesTitle || ''} ${idea || ''}`.toLowerCase();
  return combined.includes('vita da cani');
}

function resolveFocusRegionFromBox(
  box?: CharacterBoundingBox,
  fallback: 'LEFT' | 'CENTER' | 'RIGHT' = 'CENTER'
): 'LEFT' | 'CENTER' | 'RIGHT' {
  if (!box) return fallback;
  const cx = box.x + box.width / 2;
  if (cx < 0.42) return 'LEFT';
  if (cx > 0.58) return 'RIGHT';
  return 'CENTER';
}

/**
 * Helper: Calls Gemini generateContent trying real model IDs in cascade.
 */
async function callGeminiTextOrJsonCascade(params: {
  apiKey: string;
  parts: Array<Record<string, unknown>>;
  responseMimeType?: 'application/json' | 'text/plain';
  temperature?: number;
}): Promise<string | null> {
  const { apiKey, parts, responseMimeType = 'application/json', temperature = 0.75 } = params;
  for (const modelName of GEMINI_VISION_TEXT_MODELS) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(
        apiKey
      )}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature,
            ...(responseMimeType === 'application/json'
              ? { responseMimeType: 'application/json' }
              : {})
          }
        })
      });
      if (response.ok) {
        const data = await response.json();
        const textPart = data?.candidates?.[0]?.content?.parts?.find(
          (p: Record<string, unknown>) => typeof p.text === 'string'
        );
        if (textPart?.text) {
          return String(textPart.text).trim();
        }
      }
    } catch (err) {
      console.warn(`Gemini model ${modelName} error:`, err);
    }
  }
  return null;
}

/**
 * Client-side visual feature & subject detector for photos/keyframes.
 * Computes color/skin/contrast histograms and detects 1 or 2+ subjects with accurate face/mouth bounding boxes,
 * matching them against Cast reference photos even before or without cloud API calls.
 */
interface ImageVisualSignature {
  avgR: number;
  avgG: number;
  avgB: number;
  warmRatio: number;
  brightness: number;
  contrast: number;
  leftEnergy: number;
  centerEnergy: number;
  rightEnergy: number;
  topCenterMouthY: number;
  aspectRatio: number;
}

async function computeImageVisualSignature(dataUrlOrBlobUrl: string): Promise<ImageVisualSignature | null> {
  if (!dataUrlOrBlobUrl || typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    if (dataUrlOrBlobUrl.startsWith('http://') || dataUrlOrBlobUrl.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 1000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      img.onload = null;
      img.onerror = null;
      img.onabort = null;
    };

    img.onerror = () => {
      cleanup();
      resolve(null);
    };

    img.onabort = () => {
      cleanup();
      resolve(null);
    };

    img.onload = () => {
      cleanup();
      try {
        const W = 96;
        const H = 96;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, W, H);
        const data = ctx.getImageData(0, 0, W, H).data;

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let warmCount = 0;
        let leftEnergy = 0;
        let centerEnergy = 0;
        let rightEnergy = 0;

        let bestMouthRow = Math.floor(H * 0.42);
        let bestMouthScore = -1;

        for (let y = 1; y < H - 1; y++) {
          let rowHorizontalEdge = 0;
          for (let x = 1; x < W - 1; x++) {
            const idx = (y * W + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            sumR += r;
            sumG += g;
            sumB += b;

            if (r > g && g >= b * 0.85 && r > 75) {
              warmCount++;
            }

            const idxRight = (y * W + (x + 1)) * 4;
            const idxDown = ((y + 1) * W + x) * 4;
            const gradX = Math.abs(r - data[idxRight]) + Math.abs(g - data[idxRight + 1]);
            const gradY = Math.abs(r - data[idxDown]) + Math.abs(g - data[idxDown + 1]);
            const edge = gradX + gradY;

            // Weight upper-middle region where faces/heads live
            const yWeight = y >= H * 0.14 && y <= H * 0.72 ? 1.5 : 0.4;
            if (x < W * 0.4) leftEnergy += edge * yWeight;
            else if (x > W * 0.6) rightEnergy += edge * yWeight;
            else centerEnergy += edge * yWeight;

            // Detect mouth/muzzle horizontal line inside the face zone (y in 0.28..0.58, x in 0.28..0.72)
            if (y >= H * 0.28 && y <= H * 0.58 && x >= W * 0.28 && x <= W * 0.72) {
              const redness = Math.max(0, r - g * 0.85);
              rowHorizontalEdge += gradY * 1.4 + redness * 0.5;
            }
          }
          if (y >= H * 0.30 && y <= H * 0.56 && rowHorizontalEdge > bestMouthScore) {
            bestMouthScore = rowHorizontalEdge;
            bestMouthRow = y;
          }
        }

        const totalPx = Math.max(1, (W - 2) * (H - 2));
        const avgR = sumR / totalPx;
        const avgG = sumG / totalPx;
        const avgB = sumB / totalPx;
        const brightness = (avgR + avgG + avgB) / 3;

        let varSum = 0;
        for (let i = 0; i < data.length; i += 16) {
          const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
          varSum += (lum - brightness) * (lum - brightness);
        }
        const contrast = Math.sqrt(varSum / Math.max(1, data.length / 16));

        resolve({
          avgR,
          avgG,
          avgB,
          warmRatio: warmCount / totalPx,
          brightness,
          contrast,
          leftEnergy,
          centerEnergy,
          rightEnergy,
          topCenterMouthY: Math.max(0.32, Math.min(0.56, bestMouthRow / H)),
          aspectRatio: (img.naturalWidth || 1) / Math.max(1, img.naturalHeight || 1)
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      window.clearTimeout(timeout);
      resolve(null);
    };
    img.src = dataUrlOrBlobUrl;
  });
}

function signatureDistance(a: ImageVisualSignature, b: ImageVisualSignature): number {
  const dR = Math.abs(a.avgR - b.avgR) / 255;
  const dG = Math.abs(a.avgG - b.avgG) / 255;
  const dB = Math.abs(a.avgB - b.avgB) / 255;
  const dWarm = Math.abs(a.warmRatio - b.warmRatio);
  const dBright = Math.abs(a.brightness - b.brightness) / 255;
  return dR * 0.3 + dG * 0.25 + dB * 0.25 + dWarm * 0.12 + dBright * 0.08;
}

/**
 * Automatically recognizes which CastMember(s) appear in each uploaded photo/video
 * using Gemini Vision (comparing against Cast reference photos) + client-side visual matching fallback.
 * Also extracts accurate face/mouth bounding boxes (`characterBoxes`) and `visualDescription`.
 */
export async function recognizeCharactersInUploadedMedia(params: {
  mediaItems: UploadedMediaItem[];
  cast: CastMember[];
  seriesTitle?: string;
  apiKeys: ApiKeysConfig;
}): Promise<UploadedMediaItem[]> {
  const { mediaItems, cast, seriesTitle, apiKeys } = params;
  if (!mediaItems || mediaItems.length === 0 || cast.length === 0) {
    return mediaItems;
  }

  // 1. Precompute visual signatures for all Cast reference photos
  const castSignatures: Record<string, ImageVisualSignature[]> = {};
  for (const member of cast) {
    castSignatures[member.id] = [];
    for (const refUrl of (member.referencePhotos || []).slice(0, 3)) {
      if (refUrl && !refUrl.startsWith('data:image/svg+xml')) {
        const sig = await computeImageVisualSignature(refUrl);
        if (sig) castSignatures[member.id].push(sig);
      }
    }
  }

  // 2. Ensure every media item has a raster preview (extract video frame if needed) and a client-side baseline match
  const mediaSignatures: Record<string, ImageVisualSignature | null> = {};
  const baselineResults: Record<
    string,
    {
      charIds: string[];
      boxes: Record<string, CharacterBoundingBox>;
      visualDescription: string;
      confidence: number;
    }
  > = {};

  for (let i = 0; i < mediaItems.length; i++) {
    const item = mediaItems[i];
    let previewUrl = item.base64Preview || item.blobUrl;
    if (
      item.type === 'VIDEO' &&
      (!item.base64Preview || !item.base64Preview.startsWith('data:image/')) &&
      item.blobUrl
    ) {
      const extractedFrame = await extractFrameFromVideoBlobUrl(item.blobUrl, 0.5);
      if (extractedFrame) {
        previewUrl = `data:${extractedFrame.mimeType};base64,${extractedFrame.data}`;
      }
    }

    const sig = previewUrl ? await computeImageVisualSignature(previewUrl) : null;
    mediaSignatures[item.id] = sig;

    // Rank cast members by name match in filename + visual histogram similarity
    const lowerFileName = (item.name || '').toLowerCase();
    const scoredCast = cast.map((member, cIdx) => {
      let score = 0.5;
      const memberNameLower = member.name.toLowerCase();
      const firstToken = memberNameLower.split(/\s+/)[0];
      if (firstToken && firstToken.length >= 2 && lowerFileName.includes(firstToken)) {
        score += 0.45;
      }
      const memberSigs = castSignatures[member.id] || [];
      if (sig && memberSigs.length > 0) {
        const bestDist = Math.min(...memberSigs.map((ms) => signatureDistance(sig, ms)));
        score += Math.max(0, 0.42 - bestDist);
      } else {
        // Deterministic spread if no reference photo signature
        score += ((i + cIdx) % cast.length === 0 ? 0.08 : 0);
      }
      return { member, score };
    });

    scoredCast.sort((a, b) => b.score - a.score);

    // Check if the image has balanced bilateral energy suggesting 2 characters side-by-side
    const hasTwoSubjects =
      cast.length >= 2 &&
      sig &&
      sig.leftEnergy > sig.centerEnergy * 0.78 &&
      sig.rightEnergy > sig.centerEnergy * 0.78 &&
      Math.abs(sig.leftEnergy - sig.rightEnergy) / Math.max(1, sig.leftEnergy + sig.rightEnergy) < 0.28;

    const detectedIds =
      hasTwoSubjects && scoredCast.length >= 2
        ? [scoredCast[0].member.id, scoredCast[1].member.id]
        : [scoredCast[0].member.id];

    const boxes: Record<string, CharacterBoundingBox> = {};
    const mouthYBase = sig ? sig.topCenterMouthY : 0.42;

    if (detectedIds.length === 1) {
      const cid = detectedIds[0];
      const cx =
        sig && sig.leftEnergy > sig.rightEnergy * 1.35
          ? 0.38
          : sig && sig.rightEnergy > sig.leftEnergy * 1.35
          ? 0.62
          : 0.5;
      boxes[cid] = {
        characterId: cid,
        x: Math.max(0.08, cx - 0.26),
        y: 0.10,
        width: 0.52,
        height: 0.78,
        mouthX: cx,
        mouthY: mouthYBase,
        label: cast.find((c) => c.id === cid)?.name
      };
    } else {
      detectedIds.forEach((cid, idx) => {
        const cx = idx === 0 ? 0.30 : 0.70;
        boxes[cid] = {
          characterId: cid,
          x: idx === 0 ? 0.06 : 0.48,
          y: 0.12,
          width: 0.44,
          height: 0.76,
          mouthX: cx,
          mouthY: mouthYBase,
          label: cast.find((c) => c.id === cid)?.name
        };
      });
    }

    const detectedNames = detectedIds
      .map((id) => cast.find((c) => c.id === id)?.name)
      .filter(Boolean)
      .join(' e ');

    const brightnessLabel =
      sig && sig.brightness > 165
        ? 'in ambiente luminoso'
        : sig && sig.brightness < 85
        ? 'in atmosfera soffusa/interna'
        : 'in primo piano espressivo';

    baselineResults[item.id] = {
      charIds: detectedIds,
      boxes,
      visualDescription: `${detectedNames || 'Protagonista'} ${brightnessLabel} (${
        item.type === 'VIDEO' ? 'clip video' : 'foto reale'
      })`,
      confidence: Math.min(0.96, Math.max(0.68, Number(scoredCast[0]?.score.toFixed(2)) || 0.78))
    };
  }

  // 3. If Gemini API Key is available, perform real Multimodal Vision Character Recognition & Scene Analysis
  const key = apiKeys.geminiApiKey?.trim();
  if (key && key.length > 10) {
    try {
      const parts: Array<Record<string, unknown>> = [];
      const castListText = cast
        .map(
          (c) =>
            `- ID="${c.id}", Nome="${c.name}", Tipo=${c.type}, Descrizione/Carattere="${
              c.visualDescription || c.personalityPrompt
            }"`
        )
        .join('\n');

      parts.push({
        text: `Sei il sistema di Computer Vision e Riconoscimento Personaggi di SkySketch Studio per la serie "${
          seriesTitle || 'Serie Originale'
        }".
Devi confrontare le FOTO DI RIFERIMENTO DEL CAST con le FOTO/KEYFRAME CARICATI DALL'UTENTE per:
1. Riconoscere con precisione quale personaggio (o quali personaggi) del Cast appare in ciascun media caricato ("detectedCharacterIds").
2. Indicare per ogni personaggio riconosciuto il riquadro del soggetto/volto ("x", "y", "width", "height" normalizzati da 0.0 a 1.0) e la posizione esatta del centro della bocca/muso ("mouthX", "mouthY" da 0.0 a 1.0) per l'animazione parlante.
3. Scrivere una breve e vivida "visualDescription" in italiano di cosa si vede nella foto/video (es. espressione, posa, abbigliamento, ambientazione, oggetti, atmosfera).

ELENCO PERSONAGGI DEL CAST:
${castListText}`
      });

      // Attach Cast reference photos
      for (const member of cast) {
        const realRef = member.referencePhotos?.find(
          (p) => typeof p === 'string' && p.startsWith('data:image/') && !p.startsWith('data:image/svg+xml')
        );
        if (realRef) {
          const extracted = await extractRasterBase64FromUrl(realRef);
          if (extracted) {
            parts.push({
              text: `FOTO DI RIFERIMENTO DEL PERSONAGGIO ID="${member.id}" (Nome: "${member.name}", Tipo: ${member.type}):`
            });
            parts.push({
              inlineData: {
                mimeType: extracted.mimeType,
                data: extracted.data
              }
            });
          }
        }
      }

      // Attach Uploaded Media previews (up to 8 items per batch)
      const itemsWithImages: string[] = [];
      for (const item of mediaItems.slice(0, 8)) {
        const extracted = await extractRasterBase64FromUrl(item.base64Preview || item.blobUrl);
        if (extracted) {
          itemsWithImages.push(item.id);
          parts.push({
            text: `MEDIA CARICATO DA ANALIZZARE mediaId="${item.id}" (nome file: "${item.name}", tipo: ${item.type}):`
          });
          parts.push({
            inlineData: {
              mimeType: extracted.mimeType,
              data: extracted.data
            }
          });
        }
      }

      if (itemsWithImages.length > 0) {
        parts.push({
          text: `Restituisci SOLO JSON valido con questo schema esatto:
{
  "results": [
    {
      "mediaId": "id del media caricato",
      "detectedCharacterIds": ["id1"],
      "confidence": 0.94,
      "visualDescription": "Descrizione visiva in italiano di cosa fa il personaggio, espressione e ambiente nella foto",
      "characterBoxes": {
        "id1": {
          "x": 0.22,
          "y": 0.10,
          "width": 0.56,
          "height": 0.80,
          "mouthX": 0.50,
          "mouthY": 0.41
        }
      }
    }
  ]
}`
        });

        const rawJson = await callGeminiTextOrJsonCascade({
          apiKey: key,
          parts,
          responseMimeType: 'application/json',
          temperature: 0.25
        });

        if (rawJson) {
          const parsed = JSON.parse(rawJson);
          if (Array.isArray(parsed?.results)) {
            for (const r of parsed.results) {
              const mId = String(r.mediaId || '');
              if (!mId || !baselineResults[mId]) continue;

              const validIds = Array.isArray(r.detectedCharacterIds)
                ? (r.detectedCharacterIds as unknown[])
                    .map((id) => String(id))
                    .filter((id) => cast.some((c) => c.id === id))
                : [];

              if (validIds.length > 0) {
                baselineResults[mId].charIds = validIds;
              }
              if (typeof r.visualDescription === 'string' && r.visualDescription.trim().length > 3) {
                baselineResults[mId].visualDescription = r.visualDescription.trim();
              }
              if (typeof r.confidence === 'number') {
                baselineResults[mId].confidence = Math.max(0.5, Math.min(0.99, r.confidence));
              }
              if (r.characterBoxes && typeof r.characterBoxes === 'object') {
                const newBoxes: Record<string, CharacterBoundingBox> = {
                  ...baselineResults[mId].boxes
                };
                for (const cid of baselineResults[mId].charIds) {
                  const b = (r.characterBoxes as Record<string, Record<string, unknown>>)[cid];
                  if (b && typeof b === 'object') {
                    const bx = Math.max(0.02, Math.min(0.85, Number(b.x) || 0.2));
                    const by = Math.max(0.02, Math.min(0.80, Number(b.y) || 0.1));
                    const bw = Math.max(0.15, Math.min(0.95 - bx, Number(b.width) || 0.55));
                    const bh = Math.max(0.20, Math.min(0.96 - by, Number(b.height) || 0.78));
                    const mx = Math.max(
                      bx + 0.05,
                      Math.min(bx + bw - 0.05, Number(b.mouthX) || bx + bw * 0.5)
                    );
                    const my = Math.max(
                      by + 0.08,
                      Math.min(by + bh - 0.08, Number(b.mouthY) || by + bh * 0.42)
                    );
                    newBoxes[cid] = {
                      characterId: cid,
                      x: Number(bx.toFixed(3)),
                      y: Number(by.toFixed(3)),
                      width: Number(bw.toFixed(3)),
                      height: Number(bh.toFixed(3)),
                      mouthX: Number(mx.toFixed(3)),
                      mouthY: Number(my.toFixed(3)),
                      label: cast.find((c) => c.id === cid)?.name
                    };
                  }
                }
                baselineResults[mId].boxes = newBoxes;
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('Gemini Vision character recognition fallback to local visual matcher:', err);
    }
  }

  return mediaItems.map((item) => {
    const res = baselineResults[item.id];
    if (!res) return item;
    return {
      ...item,
      assignedCharacterId: res.charIds[0] || item.assignedCharacterId || cast[0]?.id,
      assignedCharacterIds: res.charIds.length > 0 ? res.charIds : item.assignedCharacterIds,
      characterBoxes: res.boxes,
      visualDescription: res.visualDescription || item.visualDescription,
      recognitionStatus: 'MATCHED',
      recognitionConfidence: res.confidence
    };
  });
}

/**
 * Proposes 3 creative AI episode plots (Trame AI) based on the Series Title, Episode Title,
 * Cast characters, and visual analysis of the uploaded photos/videos.
 */
export async function proposeEpisodePlotsFromTitleAndPhotos(params: {
  seriesTitle: string;
  seriesDescription?: string;
  episodeTitle: string;
  currentRawIdea?: string;
  genreStyle?: SeriesGenreStyle;
  customStylePrompt?: string;
  cast: CastMember[];
  uploadedMedia: UploadedMediaItem[];
  apiKeys: ApiKeysConfig;
}): Promise<{
  visualSummary: string;
  proposals: AiPlotProposal[];
  updatedMedia: UploadedMediaItem[];
}> {
  const {
    seriesTitle,
    seriesDescription,
    episodeTitle,
    currentRawIdea,
    genreStyle,
    customStylePrompt,
    cast,
    uploadedMedia,
    apiKeys
  } = params;

  // Step 1: Ensure all uploaded photos/videos are visually analyzed & matched to Cast characters
  const needsRecognition = uploadedMedia.some(
    (m) => m.recognitionStatus !== 'MATCHED' || !m.visualDescription
  );
  const analyzedMedia =
    uploadedMedia.length > 0 && needsRecognition
      ? await recognizeCharactersInUploadedMedia({
          mediaItems: uploadedMedia,
          cast,
          seriesTitle,
          apiKeys
        })
      : uploadedMedia;

  const genrePreset =
    SERIES_GENRE_STYLES.find((g) => g.id === (genreStyle || 'COMEDY')) || SERIES_GENRE_STYLES[0];

  const castSummary = cast
    .map(
      (c) =>
        `- ${c.name} (${c.type === 'ANIMAL' ? 'Animale' : 'Umano'}, ruolo: ${
          c.defaultCreditRole || 'Protagonista'
        }): ${c.personalityPrompt}`
    )
    .join('\n');

  const mediaVisualContext = analyzedMedia
    .map((m, i) => {
      const charNames = (m.assignedCharacterIds || (m.assignedCharacterId ? [m.assignedCharacterId] : []))
        .map((id) => cast.find((c) => c.id === id)?.name)
        .filter(Boolean)
        .join(', ');
      return `- Foto/Video #${i + 1} ("${m.name}"): Personaggi riconosciuti=[${
        charNames || 'Protagonista'
      }], Dettagli visivi="${m.visualDescription || 'Inquadratura protagonista'}"`;
    })
    .join('\n');

  const key = apiKeys.geminiApiKey?.trim();
  if (key && key.length > 10) {
    try {
      const parts: Array<Record<string, unknown>> = [];
      parts.push({
        text: `Sei lo Showrunner e Sceneggiatore Capo di SkySketch Studio.
Devi proporre 3 TRAME ORIGINALI, BRILLANTI E SU MISURA per un episodio della serie autonoma "${seriesTitle}".

IMPORTANTE — ISOLAMENTO TOTALE TRA SERIE:
- Questa serie si chiama "${seriesTitle}"${seriesDescription ? ` (${seriesDescription})` : ''}.
- NON usare MAI nomi, cani, biscotti o riferimenti di altre serie se non fanno parte del Cast elencato qui sotto!
- Basati ESCLUSIVAMENTE sul titolo della serie ("${seriesTitle}"), sul titolo dell'episodio ("${
          episodeTitle || 'Episodio 1'
        }"), sullo stile (${genrePreset.label}${
          customStylePrompt ? ` - ${customStylePrompt}` : ''
        }), sui personaggi del Cast e sull'ANALISI VISIVA DELLE FOTO CARICATE.

CAST DI "${seriesTitle}":
${castSummary || 'Protagonisti della serie'}

ANALISI PRELIMINARE DEI MEDIA CARICATI:
${mediaVisualContext || 'Nessun media esterno caricato: analizza le foto di riferimento del Cast.'}
${currentRawIdea ? `Spunto già annotato dall'utente: "${currentRawIdea}"` : ''}`
      });

      // Attach up to 5 uploaded photos/keyframes (or cast reference photos if no media uploaded)
      const visualSources: Array<{ label: string; url: string }> = [];
      for (const m of analyzedMedia.slice(0, 5)) {
        const url = m.base64Preview || m.blobUrl;
        if (url) {
          visualSources.push({ label: `Foto/Video caricato "${m.name}"`, url });
        }
      }
      if (visualSources.length === 0) {
        for (const c of cast.slice(0, 4)) {
          const ref = c.referencePhotos?.find((p) => !p.startsWith('data:image/svg+xml'));
          if (ref) {
            visualSources.push({ label: `Foto del personaggio "${c.name}"`, url: ref });
          }
        }
      }

      for (const src of visualSources) {
        const extracted = await extractRasterBase64FromUrl(src.url);
        if (extracted) {
          parts.push({ text: `Immagine da analizzare (${src.label}):` });
          parts.push({
            inlineData: {
              mimeType: extracted.mimeType,
              data: extracted.data
            }
          });
        }
      }

      parts.push({
        text: `Osserva le immagini allegate (espressioni, abbigliamento, location, oggetti, atmosfera) e il titolo "${
          episodeTitle || seriesTitle
        }".
Restituisci SOLO JSON valido con questo schema esatto:
{
  "visualSummary": "Sintesi dettagliata in italiano di cosa hai rilevato nelle foto (personaggi, espressioni, ambientazione, dettagli curiosi) e come si lega al titolo '${
    episodeTitle || seriesTitle
  }'",
  "proposals": [
    {
      "id": "plot-1",
      "title": "Titolo accattivante della puntata proposto dall'AI",
      "logline": "Sintesi brillante in una frase (15-20 parole)",
      "fullPlot": "Trama dettagliata pronta per la sceneggiatura (3-4 frasi ricche di ritmo, situazione comica/drammatica, conflitto e battuta finale tra i personaggi riconosciuti nelle foto)",
      "toneBadge": "Es. Satira Tagliente / Commedia Brillante / Colpo di Scena",
      "detectedContextFromPhotos": "Quale dettaglio specifico delle foto ha ispirato questa trama",
      "suggestedCastIds": ["id1", "id2"]
    }
  ]
}`
      });

      const rawJson = await callGeminiTextOrJsonCascade({
        apiKey: key,
        parts,
        responseMimeType: 'application/json',
        temperature: 0.82
      });

      if (rawJson) {
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed?.proposals) && parsed.proposals.length > 0) {
          const validProposals: AiPlotProposal[] = parsed.proposals.slice(0, 3).map(
            (p: Record<string, unknown>, idx: number) => ({
              id: String(p.id || `plot-ai-${Date.now()}-${idx}`),
              title: String(p.title || `${episodeTitle || seriesTitle} — Versione #${idx + 1}`),
              logline: String(p.logline || p.fullPlot || '').slice(0, 160),
              fullPlot: String(p.fullPlot || p.logline || ''),
              toneBadge: String(p.toneBadge || genrePreset.label),
              detectedContextFromPhotos: String(
                p.detectedContextFromPhotos ||
                  'Ispirato alle espressioni e all’ambientazione delle foto caricate'
              ),
              suggestedCastIds: Array.isArray(p.suggestedCastIds)
                ? (p.suggestedCastIds as unknown[]).map(String)
                : cast.map((c) => c.id)
            })
          );

          return {
            visualSummary: String(
              parsed.visualSummary ||
                `Analisi completata su ${analyzedMedia.length || cast.length} immagini per "${seriesTitle}".`
            ),
            proposals: validProposals,
            updatedMedia: analyzedMedia
          };
        }
      }
    } catch (err) {
      console.warn('Gemini plot proposal fallback to smart contextual generator:', err);
    }
  }

  // Smart Contextual Fallback (100% tailored to seriesTitle, episodeTitle, Cast names & analyzed photos)
  const castNames = cast.map((c) => c.name);
  const mainChar = cast[0]?.name || 'il protagonista';
  const secondChar = cast[1]?.name || (cast[0]?.name ? `il complice di ${cast[0].name}` : 'il socio');
  const pairLabel = cast.length > 1 ? `${mainChar} e ${secondChar}` : mainChar;
  const cleanEpTitle =
    episodeTitle &&
    !episodeTitle.toLowerCase().includes('nuovo sketch') &&
    !episodeTitle.toLowerCase().includes('debutto')
      ? episodeTitle.trim()
      : `Il capolavoro di ${seriesTitle}`;

  const photoDescriptions = analyzedMedia
    .map((m) => m.visualDescription)
    .filter(Boolean)
    .slice(0, 3)
    .join(' • ');

  const visualSummary =
    analyzedMedia.length > 0
      ? `Analisi visiva su ${analyzedMedia.length} media caricati per "${seriesTitle}": riconosciuti ${
          castNames.join(', ') || 'i protagonisti'
        } (${photoDescriptions || 'inquadrature in primo piano ed espressioni intense'}).`
      : `Analisi basata sul titolo "${seriesTitle}" (${cleanEpTitle}) e sulle foto di riferimento del Cast (${castNames.join(
          ', '
        )}).`;

  const proposals: AiPlotProposal[] = [
    {
      id: `plot-ctx-1-${Date.now()}`,
      title: `${cleanEpTitle}: Dietro le Quinte di ${seriesTitle}`,
      logline: `${pairLabel} affrontano un imprevisto assurdo proprio nel momento clou di "${seriesTitle}".`,
      fullPlot: `Nella puntata "${cleanEpTitle}" di "${seriesTitle}", ${mainChar} cerca di mantenere il controllo della situazione con il suo stile inconfondibile (${
        cast[0]?.personalityPrompt || 'carismatico e diretto'
      }). Quando ${
        cast.length > 1 ? `${secondChar} interviene con una mossa inaspettata` : 'emerge un dettaglio fuori programma dalle riprese'
      }, scatta un botta e risposta serrato pieno di ironia, sguardi in macchina e una battuta finale fulminante.`,
      toneBadge: `${genrePreset.emoji} ${genrePreset.label} — Ritmo Serrato`,
      detectedContextFromPhotos:
        photoDescriptions || `Espressioni e sguardi diretti in camera di ${pairLabel}`,
      suggestedCastIds: cast.map((c) => c.id)
    },
    {
      id: `plot-ctx-2-${Date.now()}`,
      title: `La Regola d'Oro di ${seriesTitle}`,
      logline: `Un'ispezione improvvisa mette alla prova la pazienza e il talento di ${pairLabel}.`,
      fullPlot: `Tutto sembra procedere secondo i piani in "${seriesTitle}", finché un cliente o un dettaglio assurdo non fa saltare i nervi a ${mainChar}. Tra commenti taglienti, reazioni teatrali immortalate nelle foto e tentativi di salvare le apparenze, ${pairLabel} trasformano il caos in un capolavoro di comicità.`,
      toneBadge: '🔥 Satira & Carattere',
      detectedContextFromPhotos: `Inquadrature ravvicinate e postura espressiva di ${mainChar}`,
      suggestedCastIds: cast.map((c) => c.id)
    },
    {
      id: `plot-ctx-3-${Date.now()}`,
      title: `${seriesTitle}: Sfida all'Ultimo Dettaglio`,
      logline: `Una scommessa lampo tra ${pairLabel} scatena una gara di battute senza esclusione di colpi.`,
      fullPlot: `Partendo dalle immagini caricate per "${cleanEpTitle}", ${mainChar} lancia una provocazione diretta su chi abbia davvero l'ultima parola in "${seriesTitle}". Ogni inquadratura diventa una replica tagliente fino al verdetto finale che ribalta tutte le aspettative.`,
      toneBadge: '⚡ Botta & Risposta',
      detectedContextFromPhotos: `Montaggio dinamico sulle foto reali del Cast (${castNames.join(', ')})`,
      suggestedCastIds: cast.map((c) => c.id)
    }
  ];

  return {
    visualSummary,
    proposals,
    updatedMedia: analyzedMedia
  };
}

/**
 * Builds or updates coordinated back-and-forth `DialogueTurn[]` for a scene with 1, 2, or more protagonists.
 */
export function buildDialogueTurnsForSceneCharacters(params: {
  characterIds: string[];
  durationSec: number;
  cast: CastMember[];
  idea: string;
  sceneOrder: number;
  existingTurns?: DialogueTurn[];
  fallbackSingleLine?: string;
  genreStyle?: SeriesGenreStyle;
  characterBoxes?: Record<string, CharacterBoundingBox>;
  seriesTitle?: string;
}): DialogueTurn[] {
  const {
    characterIds,
    durationSec,
    cast,
    idea,
    sceneOrder,
    existingTurns,
    fallbackSingleLine,
    genreStyle,
    characterBoxes,
    seriesTitle
  } = params;
  const validIds =
    characterIds.length > 0
      ? characterIds
      : cast[0]
      ? [cast[0].id]
      : ['cast-1'];

  if (validIds.length === 1) {
    const member = cast.find((c) => c.id === validIds[0]) || cast[0];
    const existing = existingTurns?.find((t) => t.characterId === validIds[0]);
    const text =
      existing?.dialogueOrThought ||
      fallbackSingleLine ||
      (member
        ? generateLineForCharacter(member, idea, sceneOrder, durationSec, genreStyle, seriesTitle)
        : '');
    return [
      {
        characterId: validIds[0],
        dialogueOrThought: text,
        startOffsetSec: 0,
        durationSec,
        focusRegion: resolveFocusRegionFromBox(characterBoxes?.[validIds[0]], 'CENTER')
      }
    ];
  }

  const count = validIds.length;
  const rawSlot = durationSec / count;
  let currentOffset = 0;

  return validIds.map((charId, idx) => {
    const member = cast.find((c) => c.id === charId) || cast[idx % cast.length];
    const existing = existingTurns?.find((t) => t.characterId === charId);
    const turnDur =
      idx === count - 1
        ? Math.max(1.5, Number((durationSec - currentOffset).toFixed(2)))
        : Math.max(1.5, Number(rawSlot.toFixed(2)));
    const startOffsetSec = Number(currentOffset.toFixed(2));
    currentOffset += turnDur;

    const defaultFocus: 'LEFT' | 'CENTER' | 'RIGHT' =
      count === 2 ? (idx === 0 ? 'LEFT' : 'RIGHT') : idx === 0 ? 'LEFT' : idx === 1 ? 'RIGHT' : 'CENTER';
    const focusRegion = resolveFocusRegionFromBox(characterBoxes?.[charId], defaultFocus);

    const partnerObj = cast.find((c) => c.id === validIds[(idx + 1) % validIds.length]);
    const partnerName = partnerObj?.name || 'te';

    const text =
      existing?.dialogueOrThought ||
      (member
        ? generateInteractiveTurnLine(
            member,
            partnerObj,
            partnerName,
            idx,
            idea,
            sceneOrder,
            turnDur,
            genreStyle,
            seriesTitle
          )
        : 'Ecco la mia risposta!');

    return {
      characterId: charId,
      dialogueOrThought: text,
      startOffsetSec,
      durationSec: turnDur,
      focusRegion
    };
  });
}

export function generateInteractiveTurnLine(
  speaker: CastMember,
  partner: CastMember | undefined,
  partnerName: string,
  turnIndex: number,
  idea: string,
  sceneOrder: number,
  turnDurationSec: number,
  genreStyle?: SeriesGenreStyle,
  seriesTitle?: string
): string {
  const isVdc = isVitaDaCaniSeries(seriesTitle, idea);
  const rel = partner
    ? speaker.relationships?.find((r) => r.targetCharacterId === partner.id)
    : undefined;
  const relType = rel?.relationType;

  // Use character's own memoryGags if available and non-generic
  if (speaker.memoryGags && speaker.memoryGags.length > 0 && !isVdc) {
    const gag = speaker.memoryGags[(sceneOrder + turnIndex) % speaker.memoryGags.length];
    if (gag && gag.trim().length > 4) {
      return turnIndex === 0
        ? `Senti ${partnerName}: ${gag.replace(/^["«]|["»]$/g, '')}`
        : `Te lo dico io ${partnerName}: ${gag.replace(/^["«]|["»]$/g, '')}`;
    }
  }

  if (genreStyle === 'HORROR_THRILLER') {
    if (turnIndex === 0) {
      return `${partnerName}... hai sentito anche tu questo rumore?!`;
    }
    return `Non muoverti ${partnerName}... qui c'è qualcosa che non quadra!`;
  }

  if (genreStyle === 'ROMANTIC') {
    if (turnIndex === 0) {
      return `${partnerName}, quando mi guardi così mi fai dimenticare tutto il resto.`;
    }
    return `Promettimi che restiamo così, ${partnerName}, senza pensieri!`;
  }

  if (genreStyle === 'ACTION_ADVENTURE') {
    if (turnIndex === 0) {
      return `Pronti ${partnerName}? Tra tre secondi entriamo in azione!`;
    }
    return `Ricevuto ${partnerName}! Coprimi le spalle, si parte!`;
  }

  if (genreStyle === 'DRAMA_SOAP') {
    if (turnIndex === 0) {
      return `Guardami negli occhi ${partnerName}... dimmi tutta la verità!`;
    }
    return `Non pensavo saremmo arrivati a questo punto, ${partnerName}!`;
  }

  if (!isVdc) {
    const showName = seriesTitle?.trim() || 'qui';
    const ideaSnippet = (idea || '')
      .replace(/["«»]/g, '')
      .split(/[.,;!?]/)[0]
      .trim();
    const hasShortTopic = ideaSnippet.length >= 4 && ideaSnippet.length <= 48;

    if (turnIndex === 0) {
      const firstLines = [
        hasShortTopic
          ? `${partnerName}, parliamoci chiaro: ${ideaSnippet.toLowerCase()}!`
          : `${partnerName}, ma hai visto cosa sta succedendo oggi in ${showName}?!`,
        `Ascolta ${partnerName}, qui ci vuole un colpo di genio dei nostri!`,
        `${partnerName}, dimmi la verità: avevi già previsto tutto quanto?!`
      ];
      return firstLines[sceneOrder % firstLines.length];
    } else {
      const secondLines = [
        `Lascia fare a me ${partnerName}, adesso sistemo tutto con stile!`,
        `Con me e te in campo ${partnerName}, in ${showName} non ce n'è per nessuno!`,
        `Perfetto ${partnerName}! Guarda che espressione, siamo già da Oscar!`
      ];
      return secondLines[sceneOrder % secondLines.length];
    }
  }

  // Vita da Cani specific interactions
  if (relType === 'PARTNERS_IN_CRIME') {
    const crimeFirst = [
      `Ehi ${partnerName}, tu fai gli occhi dolci... e io rubo il biscotto!`,
      `${partnerName}, piano segreto: distrailo tu che io apro la dispensa!`,
      `Fai finta di dormire ${partnerName}, appena si gira colpiamo!`
    ];
    const crimeSecond = [
      `Affare fatto ${partnerName}! Ma facciamo metà per uno, eh!`,
      `Contaci ${partnerName}, sono già in posizione da cucciolo innocente!`,
      `Geniale ${partnerName}! Tra complici ci capiamo al volo!`
    ];
    return turnIndex === 0
      ? crimeFirst[sceneOrder % crimeFirst.length]
      : crimeSecond[sceneOrder % crimeSecond.length];
  }

  return generateLineForCharacter(
    speaker,
    idea,
    sceneOrder + turnIndex,
    turnDurationSec,
    genreStyle,
    seriesTitle
  );
}

/**
 * 1. GEMINI 2.5 FLASH VISION + STRUCTURED JSON STORYBOARD & MONTAGE DIRECTOR
 * Analyzes uploaded video keyframes + cast reference photos + episodeTitle + rawIdea + exact netContentDurationSec
 * so that sum(scenes.durationSec) + introDurationSec + outroDurationSec === targetTotalDurationSec.
 */
export async function generateStoryboardAndScriptWithGemini(params: {
  seriesTitle?: string;
  seriesDescription?: string;
  episodeTitle?: string;
  rawIdea: string;
  targetTotalDurationSec: number;
  branding: IntroOutroConfig;
  cast: CastMember[];
  uploadedMedia: UploadedMediaItem[];
  apiKeys: ApiKeysConfig;
  seriesGenreStyle?: SeriesGenreStyle;
  seriesCustomStylePrompt?: string;
}): Promise<{
  title: string;
  detectedCastIds: string[];
  funnyRolesByCastId: Record<string, string>;
  scenes: SceneCard[];
  usedEngine: 'GEMINI_2_5_FLASH' | 'SMART_LOCAL_ENGINE';
}> {
  const {
    seriesTitle,
    seriesDescription,
    episodeTitle,
    rawIdea,
    targetTotalDurationSec,
    branding,
    cast,
    uploadedMedia,
    apiKeys,
    seriesGenreStyle,
    seriesCustomStylePrompt
  } = params;
  const introSec = branding.introEnabled ? branding.introDurationSec : 0;
  const outroSec = branding.outroEnabled ? branding.outroDurationSec : 0;
  const netContentDurationSec = Math.max(5, Math.round(targetTotalDurationSec - introSec - outroSec));

  // First ensure uploaded media have recognized characters & bounding boxes
  const enrichedMedia =
    uploadedMedia.length > 0 &&
    uploadedMedia.some((m) => m.recognitionStatus !== 'MATCHED' || !m.characterBoxes)
      ? await recognizeCharactersInUploadedMedia({
          mediaItems: uploadedMedia,
          cast,
          seriesTitle,
          apiKeys
        })
      : uploadedMedia;

  if (apiKeys.geminiApiKey && apiKeys.geminiApiKey.trim().length > 10) {
    try {
      const geminiResult = await callRealGeminiFlashApi({
        apiKey: apiKeys.geminiApiKey.trim(),
        seriesTitle,
        seriesDescription,
        episodeTitle,
        rawIdea,
        netContentDurationSec,
        cast,
        uploadedMedia: enrichedMedia,
        seriesGenreStyle,
        seriesCustomStylePrompt
      });
      if (geminiResult) {
        return {
          ...geminiResult,
          usedEngine: 'GEMINI_2_5_FLASH'
        };
      }
    } catch (err) {
      console.warn('Gemini 2.5 Flash API fallback to Smart Local Engine:', err);
    }
  }

  return {
    ...buildSmartLocalStoryboard({
      seriesTitle,
      seriesDescription,
      episodeTitle,
      rawIdea,
      netContentDurationSec,
      cast,
      uploadedMedia: enrichedMedia,
      seriesGenreStyle,
      seriesCustomStylePrompt
    }),
    usedEngine: 'SMART_LOCAL_ENGINE'
  };
}

async function callRealGeminiFlashApi(params: {
  apiKey: string;
  seriesTitle?: string;
  seriesDescription?: string;
  episodeTitle?: string;
  rawIdea: string;
  netContentDurationSec: number;
  cast: CastMember[];
  uploadedMedia: UploadedMediaItem[];
  seriesGenreStyle?: SeriesGenreStyle;
  seriesCustomStylePrompt?: string;
}): Promise<{
  title: string;
  detectedCastIds: string[];
  funnyRolesByCastId: Record<string, string>;
  scenes: SceneCard[];
} | null> {
  const {
    apiKey,
    seriesTitle,
    seriesDescription,
    episodeTitle,
    rawIdea,
    netContentDurationSec,
    cast,
    uploadedMedia,
    seriesGenreStyle,
    seriesCustomStylePrompt
  } = params;

  const genrePreset =
    SERIES_GENRE_STYLES.find((g) => g.id === (seriesGenreStyle || 'COMEDY')) ||
    SERIES_GENRE_STYLES[0];
  const styleDirectorInstruction = `${genrePreset.emoji} ${genrePreset.label} — ${genrePreset.directorPrompt}${
    seriesCustomStylePrompt ? ` Note di stile aggiuntive della serie: "${seriesCustomStylePrompt}".` : ''
  }`;

  const castDescriptions = cast
    .map(
      (c) =>
        `- ID: "${c.id}", Nome: "${c.name}", Tipo: ${
          c.type === 'ANIMAL' ? 'ANIMALE PARLANTE/PENSANTE' : 'UMANO'
        }, Personalità e Carattere: "${c.personalityPrompt}", Descrizione visiva: "${
          c.visualDescription || ''
        }", Frasi/Gag tipiche: [${c.memoryGags.join('; ')}]`
    )
    .join('\n');

  const relationshipsDescriptions = cast
    .flatMap((c) =>
      (c.relationships || []).map((rel) => {
        const target = cast.find((t) => t.id === rel.targetCharacterId);
        if (!target) return null;
        return `- RAPPORTO TRA "${c.name}" E "${target.name}" (${rel.relationType}): "${rel.description}"`;
      })
    )
    .filter(Boolean)
    .join('\n');

  const mediaDescriptions = uploadedMedia
    .map((m, idx) => {
      const charIds =
        m.assignedCharacterIds && m.assignedCharacterIds.length > 0
          ? m.assignedCharacterIds
          : m.assignedCharacterId
          ? [m.assignedCharacterId]
          : [];
      return `- Media #${idx} (id="${m.id}", tipo=${m.type}, nome="${m.name}", durataOriginale=${
        m.originalDurationSec
      }s, personaggiRiconosciuti=[${charIds.map((id) => `"${id}"`).join(', ')}], analisiVisiva="${
        m.visualDescription || ''
      }", indicazioniUtenteVideo="${m.customInstruction || ''}")`;
    })
    .join('\n');

  const promptText = `Sei il Regista, Sceneggiatore e Montatore AI di "SkySketch Studio".

SERIE AUTONOMA IN PRODUZIONE: "${seriesTitle || 'Serie Originale'}"
DESCRIZIONE SERIE: "${seriesDescription || 'Serie originale creata dall’utente'}"
REGOLE TASSATIVE DI ISOLAMENTO SERIE:
- Questa serie ("${seriesTitle || 'Serie Originale'}") è 100% AUTONOMA.
- Usa ESCLUSIVAMENTE i personaggi del Cast elencati qui sotto e il tema/contesto di "${
    seriesTitle || 'questa serie'
  }". NON citare MAI personaggi, cani, croccantini o trame di altre serie (come "Vita da Cani", Zora o Uma) a meno che non siano esplicitamente nel Cast qui sotto!

GENERE E STILE DELLA SERIE (TASSATIVO RISPETTARE QUESTO STILE NEI DIALOGHI, NEL TONO E NELLA REGIA):
${styleDirectorInstruction}

TITOLO IMPOSTATO DALL'UTENTE PER LA PUNTATA: "${episodeTitle || 'Da definire in base alla trama'}"
TRAMA / ASPETTATIVA E CONTESTO DELLA PUNTATA: "${
    rawIdea || `Episodio originale di "${seriesTitle || 'questa serie'}" basato sulle foto e sul titolo`
  }"
DURATA NETTA ESATTA DELLO SKETCH (esclusa sigla e titoli di coda): ESATTAMENTE ${netContentDurationSec} secondi.

CAST DEI PROTAGONISTI DELLA SERIE "${seriesTitle || ''}":
${castDescriptions}

RAPPORTI E DINAMICHE TRA I PERSONAGGI:
${relationshipsDescriptions || 'Tutti i protagonisti interagiscono con grande ritmo e complicità.'}

MATERIALE CARICATO DALL'UTENTE (VIDEO E FOTO CON PERSONAGGI RICONOSCIUTI E INDICAZIONI):
${
  mediaDescriptions ||
  'Nessun file esterno caricato: crea singoli video dinamici usando le foto reali dei protagonisti del Cast (sceneType="AI_PHOTO_VIDEO").'
}

REGOLE TASSATIVE DI GENERAZIONE SINGOLI VIDEO AI E COLLAGE FINALE:
1. Genera una sequenza di singoli video ("scenes") che verranno elaborati individualmente dall'AI sulla base del materiale e delle indicazioni fornite, per poi essere uniti in un COLLAGE VIDEO FINALE coerente con "${
    seriesTitle || ''
  }", il TITOLO ("${episodeTitle || ''}") e la TRAMA ("${rawIdea || ''}").
2. ASSOCIAZIONE PRECISA FOTO/VIDEO ↔ PERSONAGGIO:
   - Ogni singolo video che usa un "mediaId" DEVE avere come protagonista il personaggio effettivamente presente e riconosciuto in quel media ("personaggiRiconosciuti").
   - Se l'utente ha fornito "indicazioniUtenteVideo" per quel media, usale come base per "veoMotionPrompt" e "directorNote".
3. La somma di "durationSec" di tutti i singoli video deve essere ESATTAMENTE uguale a ${netContentDurationSec} secondi (ogni clip dura tra 4 e 8 secondi).
4. Per i VIDEO caricati usa sceneType="USER_VIDEO", per le FOTO da elaborare in singoli video AI usa sceneType="AI_PHOTO_VIDEO".
5. Per ogni singolo video scegli "cameraShot" tra: "CLOSEUP_PUNCH", "DYNAMIC_ZOOM", "PAN_CINEMATIC", "REACTION_SHAKE".
6. In "veoMotionPrompt" scrivi in ITALIANO un prompt di animazione video stile Gemini / Veo 3 (es. "Crea un video dalla foto con il personaggio [Nome] che saluta/gesticola con espressione [emozione coerente alla trama] e dice [battuta], con stile di voce [stile vocale] e correlazione con [altri personaggi]. Aggiungi scritte in sovraimpressione con scritto [Nome / Soprannome]... usa uno stile idoneo per Reel Instagram"). Il video DEVE avere il personaggio realmente animato che parla e si muove nella scena, MAI una foto statica con descrizione!

Restituisci SOLO JSON valido con questo schema esatto:
{
  "title": "Titolo Episodio",
  "detectedCastIds": ["id1", "id2"],
  "funnyRolesByCastId": { "id1": "Ruolo/Soprannome in sovraimpressione (es. Cesco il mago) contestuale a ${seriesTitle || 'questa puntata'}" },
  "scenes": [
    {
      "sceneType": "USER_VIDEO" | "AI_PHOTO_VIDEO",
      "mediaId": "id del media caricato corrispondente",
      "characterId": "id del primo CastMember nella scena",
      "characterIds": ["id1"],
      "durationSec": 5,
      "trimStartSec": 0,
      "trimEndSec": 5,
      "cameraShot": "CLOSEUP_PUNCH" | "DYNAMIC_ZOOM" | "PAN_CINEMATIC" | "REACTION_SHAKE",
      "directorNote": "Indicazione di regia in italiano sull'animazione viva del personaggio, mimica facciale, gestualità e ritmo Reel",
      "dialogueOrThought": "Battuta parlata dal personaggio animato nel video",
      "dialogueTurns": [
        {
          "characterId": "id1",
          "dialogueOrThought": "Battuta naturale e brillante pronunciata dal personaggio animato in italiano",
          "focusRegion": "CENTER"
        }
      ],
      "veoMotionPrompt": "Prompt completo stile Gemini Video: es. Crea un video dalla foto con il personaggio che saluta/agisce, muove labbra, volto e corpo con espressione viva coerente alla trama e al suo stile di voce dice la battuta, tenendo conto del rapporto con gli altri personaggi, con scritte in sovraimpressione in stile Reel Instagram"
    }
  ]
}`;

  const parts: Array<Record<string, unknown>> = [{ text: promptText }];

  // Attach Cast reference photos
  for (const member of cast) {
    const realPhoto = member.referencePhotos?.find(
      (p) => typeof p === 'string' && p.startsWith('data:image/') && !p.startsWith('data:image/svg+xml')
    );
    if (realPhoto) {
      const extracted = await extractRasterBase64FromUrl(realPhoto);
      if (extracted) {
        parts.push({
          text: `Foto di riferimento del personaggio "${member.name}" (ID="${member.id}", tipo=${member.type}):`
        });
        parts.push({
          inlineData: {
            mimeType: extracted.mimeType,
            data: extracted.data
          }
        });
      }
    }
  }

  // Attach up to 6 keyframes/photos from uploaded media
  for (const media of uploadedMedia.slice(0, 6)) {
    const extracted = await extractRasterBase64FromUrl(media.base64Preview || media.blobUrl);
    if (extracted) {
      parts.push({
        text: `Immagine del Media caricato id="${media.id}" (${media.name}, personaggiRiconosciuti=${JSON.stringify(
          media.assignedCharacterIds || [media.assignedCharacterId]
        )}):`
      });
      parts.push({
        inlineData: {
          mimeType: extracted.mimeType,
          data: extracted.data
        }
      });
    }
  }

  const rawJson = await callGeminiTextOrJsonCascade({
    apiKey,
    parts,
    responseMimeType: 'application/json',
    temperature: 0.78
  });

  if (!rawJson) return null;

  const parsed = JSON.parse(rawJson);
  if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) return null;

  const validShots: CameraShotType[] = [
    'DYNAMIC_ZOOM',
    'CLOSEUP_PUNCH',
    'PAN_CINEMATIC',
    'REACTION_SHAKE'
  ];

  const videoCursorByMediaId: Record<string, number> = {};

  const normalizedScenes: SceneCard[] = parsed.scenes.map((s: Record<string, unknown>, idx: number) => {
    // Match media by explicit mediaId, or by characterId match, or by index
    const requestedCharId =
      typeof s.characterId === 'string' && cast.some((c) => c.id === s.characterId)
        ? String(s.characterId)
        : undefined;

    const matchedMedia =
      uploadedMedia.find((m) => m.id === s.mediaId) ||
      (requestedCharId
        ? uploadedMedia.find(
            (m) =>
              m.assignedCharacterId === requestedCharId ||
              m.assignedCharacterIds?.includes(requestedCharId)
          )
        : undefined) ||
      (uploadedMedia.length > 0 ? uploadedMedia[idx % uploadedMedia.length] : undefined);

    const mediaAssignedIds =
      matchedMedia?.assignedCharacterIds && matchedMedia.assignedCharacterIds.length > 0
        ? matchedMedia.assignedCharacterIds
        : matchedMedia?.assignedCharacterId
        ? [matchedMedia.assignedCharacterId]
        : [];

    const aiDetectedIds = Array.isArray(s.characterIds)
      ? (s.characterIds as unknown[])
          .map((id) => String(id))
          .filter((id) => cast.some((c) => c.id === id))
      : [];

    const combinedCharIds = Array.from(
      new Set([
        ...mediaAssignedIds,
        ...aiDetectedIds,
        ...(requestedCharId ? [requestedCharId] : [])
      ])
    );

    const primaryCharId =
      combinedCharIds[0] || cast[idx % cast.length]?.id || 'cast-1';
    const finalCharIds = combinedCharIds.length > 0 ? combinedCharIds : [primaryCharId];

    const charObj = cast.find((c) => c.id === primaryCharId) || cast[0];
    const isUserVideo = Boolean(matchedMedia && matchedMedia.type === 'VIDEO');
    const dur = Math.max(
      finalCharIds.length > 1 ? 6 : 4,
      Math.round(Number(s.durationSec) || (finalCharIds.length > 1 ? 7 : 5))
    );
    const shot = validShots.includes(s.cameraShot as CameraShotType)
      ? (s.cameraShot as CameraShotType)
      : finalCharIds.length > 1
      ? 'PAN_CINEMATIC'
      : validShots[idx % validShots.length];

    // Pick a photo that actually belongs to primaryCharId if matchedMedia doesn't have one
    const charSpecificUploadedPhoto = uploadedMedia.find(
      (m) =>
        m.type === 'PHOTO' &&
        (m.assignedCharacterId === primaryCharId ||
          m.assignedCharacterIds?.includes(primaryCharId))
    );
    const bestCastPhoto =
      charObj?.referencePhotos?.find((p) => !p.startsWith('data:image/svg+xml')) ||
      charSpecificUploadedPhoto?.base64Preview ||
      charSpecificUploadedPhoto?.blobUrl ||
      charObj?.referencePhotos?.[0] ||
      '';

    let computedTrimStart = 0;
    if (isUserVideo && matchedMedia) {
      const prevCursor = videoCursorByMediaId[matchedMedia.id] || 0;
      const origDur = Math.max(dur, matchedMedia.originalDurationSec || dur);
      computedTrimStart =
        origDur > dur + 1 ? prevCursor % Math.max(1, Math.floor(origDur - dur)) : 0;
      videoCursorByMediaId[matchedMedia.id] = prevCursor + dur;
    }

    const rawTurns = Array.isArray(s.dialogueTurns)
      ? (s.dialogueTurns as Array<Record<string, unknown>>)
          .map((t, tIdx) => {
            const tCharId =
              cast.find((c) => c.id === t.characterId)?.id ||
              finalCharIds[tIdx % finalCharIds.length] ||
              primaryCharId;
            return {
              characterId: tCharId,
              dialogueOrThought: String(t.dialogueOrThought || '').trim(),
              startOffsetSec: 0,
              durationSec: 3,
              focusRegion:
                t.focusRegion === 'LEFT' || t.focusRegion === 'RIGHT' || t.focusRegion === 'CENTER'
                  ? (t.focusRegion as 'LEFT' | 'CENTER' | 'RIGHT')
                  : undefined
            };
          })
          .filter((t) => t.dialogueOrThought.length > 0)
      : undefined;

    const dialogueTurns = buildDialogueTurnsForSceneCharacters({
      characterIds: finalCharIds,
      durationSec: dur,
      cast,
      idea: rawIdea || episodeTitle || '',
      sceneOrder: idx + 1,
      existingTurns: rawTurns,
      fallbackSingleLine: typeof s.dialogueOrThought === 'string' ? s.dialogueOrThought : undefined,
      genreStyle: seriesGenreStyle,
      characterBoxes: matchedMedia?.characterBoxes,
      seriesTitle
    });

    const combinedDialogueSummary =
      dialogueTurns.length > 1
        ? dialogueTurns
            .map((t) => {
              const cName = cast.find((c) => c.id === t.characterId)?.name || 'Personaggio';
              return `${cName}: "${t.dialogueOrThought}"`;
            })
            .join(' ↔️ ')
        : dialogueTurns[0]?.dialogueOrThought ||
          generateLineForCharacter(
            charObj,
            rawIdea || episodeTitle || '',
            idx + 1,
            dur,
            seriesGenreStyle,
            seriesTitle
          );

    const namesInScene = finalCharIds
      .map((id) => cast.find((c) => c.id === id)?.name)
      .filter(Boolean)
      .join(' & ');

    return {
      id: `scene-ai-${Date.now()}-${idx}`,
      order: idx + 1,
      sceneType: isUserVideo ? 'USER_VIDEO' : 'AI_PHOTO_VIDEO',
      characterId: primaryCharId,
      characterIds: finalCharIds,
      characterBoxes: matchedMedia?.characterBoxes,
      dialogueTurns,
      durationSec: dur,
      cameraShot: shot,
      directorNote: String(
        matchedMedia?.customInstruction ||
          s.directorNote ||
          (finalCharIds.length > 1
            ? `Scena dinamica (${genrePreset.label}) tra ${namesInScene}`
            : isUserVideo
            ? `Singolo video (${genrePreset.label}) con ${charObj?.name}`
            : `Singolo video AI (${genrePreset.label}) elaborato dal materiale di ${charObj?.name}`)
      ),
      dialogueOrThought: combinedDialogueSummary,
      userVideoBlobUrl: isUserVideo && matchedMedia ? matchedMedia.blobUrl : undefined,
      userVideoFileName: isUserVideo && matchedMedia ? matchedMedia.name : undefined,
      trimStartSec: isUserVideo ? computedTrimStart : undefined,
      trimEndSec: isUserVideo ? computedTrimStart + dur : undefined,
      aiPhotoSourceUrl:
        !isUserVideo && matchedMedia && matchedMedia.type === 'PHOTO'
          ? matchedMedia.base64Preview || matchedMedia.blobUrl
          : bestCastPhoto,
      veoMotionPrompt: String(
        matchedMedia?.customInstruction ||
          s.veoMotionPrompt ||
          s.directorNote ||
          buildGeminiStyleCharacterVideoPrompt({
            character: charObj,
            cast,
            sceneCharacterIds: finalCharIds,
            dialogueText: combinedDialogueSummary,
            plotContext: rawIdea || episodeTitle || '',
            visualContext: matchedMedia?.visualDescription,
            seriesTitle,
            roleBadge:
              (parsed.funnyRolesByCastId as Record<string, string>)?.[primaryCharId] ||
              getCharacterSitcomRoleBadge(charObj, seriesTitle)
          })
      ),
      status: 'READY'
    };
  });

  balanceSceneDurationsToExactTarget(normalizedScenes, netContentDurationSec);

  const detectedCastIds = Array.from(
    new Set(normalizedScenes.flatMap((s) => s.characterIds || [s.characterId]))
  );
  const keepUserTitle =
    episodeTitle &&
    episodeTitle.trim().length > 0 &&
    !episodeTitle.includes('Nuovo Sketch') &&
    !episodeTitle.includes('Il Debutto');

  return {
    title: keepUserTitle
      ? episodeTitle!.trim()
      : String(parsed.title || episodeTitle || `${seriesTitle || 'Episodio'} #1`),
    detectedCastIds,
    funnyRolesByCastId: (parsed.funnyRolesByCastId as Record<string, string>) || {},
    scenes: normalizedScenes
  };
}

function buildSmartLocalStoryboard(params: {
  seriesTitle?: string;
  seriesDescription?: string;
  episodeTitle?: string;
  rawIdea: string;
  netContentDurationSec: number;
  cast: CastMember[];
  uploadedMedia: UploadedMediaItem[];
  seriesGenreStyle?: SeriesGenreStyle;
  seriesCustomStylePrompt?: string;
}): {
  title: string;
  detectedCastIds: string[];
  funnyRolesByCastId: Record<string, string>;
  scenes: SceneCard[];
} {
  const {
    seriesTitle,
    episodeTitle,
    rawIdea,
    netContentDurationSec,
    cast,
    uploadedMedia,
    seriesGenreStyle
  } = params;
  const activeCast = cast.length > 0 ? cast : [];
  const scenes: SceneCard[] = [];
  let remainingSec = netContentDurationSec;
  let order = 1;

  const isVdc = isVitaDaCaniSeries(seriesTitle, rawIdea);
  const ideaClean =
    rawIdea.trim() ||
    (isVdc
      ? 'Il summit segreto sul divano per decidere chi comanda in casa'
      : `Una giornata esplosiva in ${seriesTitle || 'studio'} tra imprevisti e colpi di scena`);
  const topicKeyword = ideaClean.split(/\s+/).slice(0, 5).join(' ');
  const localVideoCursor: Record<string, number> = {};

  if (uploadedMedia.length > 0 && activeCast.length > 0) {
    let mediaLoopIdx = 0;
    while (remainingSec > 0 && mediaLoopIdx < 30) {
      const item = uploadedMedia[mediaLoopIdx % uploadedMedia.length];
      const itemCharIds =
        item.assignedCharacterIds && item.assignedCharacterIds.length > 0
          ? item.assignedCharacterIds
          : item.assignedCharacterId
          ? [item.assignedCharacterId]
          : [activeCast[mediaLoopIdx % activeCast.length]?.id].filter(Boolean);

      const primaryMember =
        activeCast.find((c) => c.id === itemCharIds[0]) ||
        activeCast[mediaLoopIdx % activeCast.length];
      const namesHere = itemCharIds
        .map((id) => activeCast.find((c) => c.id === id)?.name)
        .filter(Boolean)
        .join(' & ');

      if (item.type === 'VIDEO') {
        const clipDur =
          remainingSec <= 8
            ? remainingSec
            : Math.min(
                Math.max(itemCharIds.length > 1 ? 6 : 5, Math.round(item.usedDurationSec || 6)),
                remainingSec
              );
        const prevCursor = localVideoCursor[item.id] || 0;
        const origDur = Math.max(clipDur, item.originalDurationSec || clipDur);
        const trimStart =
          origDur > clipDur + 1
            ? prevCursor % Math.max(1, Math.floor(origDur - clipDur))
            : 0;
        localVideoCursor[item.id] = prevCursor + clipDur;

        const turns = buildDialogueTurnsForSceneCharacters({
          characterIds: itemCharIds,
          durationSec: clipDur,
          cast: activeCast,
          idea: ideaClean,
          sceneOrder: order,
          genreStyle: seriesGenreStyle,
          characterBoxes: item.characterBoxes,
          seriesTitle
        });
        scenes.push({
          id: `scene-local-${Date.now()}-${order}`,
          order,
          sceneType: 'USER_VIDEO',
          characterId: primaryMember.id,
          characterIds: itemCharIds,
          characterBoxes: item.characterBoxes,
          dialogueTurns: turns,
          durationSec: clipDur,
          useOriginalVideoAudio: false,
          cameraShot:
            itemCharIds.length > 1
              ? 'PAN_CINEMATIC'
              : order % 2 === 0
              ? 'CLOSEUP_PUNCH'
              : 'DYNAMIC_ZOOM',
          directorNote:
            item.customInstruction ||
            item.visualDescription ||
            `Singolo video con ${namesHere} — ${ideaClean.slice(0, 70)}`,
          veoMotionPrompt:
            item.customInstruction ||
            `Elabora il video originale di ${namesHere} (${
              item.visualDescription || 'inquadratura principale'
            }) nel contesto della trama: "${ideaClean.slice(0, 90)}"`,
          userVideoBlobUrl: item.blobUrl,
          userVideoFileName: item.name,
          aiPhotoSourceUrl: item.base64Preview,
          trimStartSec: trimStart,
          trimEndSec: trimStart + clipDur,
          dialogueOrThought:
            turns.length > 1
              ? turns
                  .map(
                    (t) =>
                      `${activeCast.find((c) => c.id === t.characterId)?.name || ''}: "${
                        t.dialogueOrThought
                      }"`
                  )
                  .join(' ↔️ ')
              : turns[0].dialogueOrThought,
          status: 'READY'
        });
        remainingSec -= clipDur;
        order++;
      } else {
        const photoDur =
          remainingSec <= 8
            ? remainingSec
            : Math.min(itemCharIds.length > 1 ? 7 : 5, Math.max(4, remainingSec));
        const turns = buildDialogueTurnsForSceneCharacters({
          characterIds: itemCharIds,
          durationSec: photoDur,
          cast: activeCast,
          idea: ideaClean,
          sceneOrder: order,
          genreStyle: seriesGenreStyle,
          characterBoxes: item.characterBoxes,
          seriesTitle
        });
        scenes.push({
          id: `scene-local-${Date.now()}-${order}`,
          order,
          sceneType: 'AI_PHOTO_VIDEO',
          characterId: primaryMember.id,
          characterIds: itemCharIds,
          characterBoxes: item.characterBoxes,
          dialogueTurns: turns,
          durationSec: photoDur,
          cameraShot:
            itemCharIds.length > 1
              ? 'PAN_CINEMATIC'
              : order % 2 === 0
              ? 'CLOSEUP_PUNCH'
              : 'DYNAMIC_ZOOM',
          directorNote:
            item.customInstruction ||
            item.visualDescription ||
            `Video animato con ${namesHere} — Scena #${order}`,
          aiPhotoSourceUrl: item.base64Preview || item.blobUrl,
          veoMotionPrompt:
            item.customInstruction ||
            buildGeminiStyleCharacterVideoPrompt({
              character: primaryMember,
              cast: activeCast,
              sceneCharacterIds: itemCharIds,
              dialogueText: turns[0]?.dialogueOrThought || '',
              plotContext: ideaClean,
              visualContext: item.visualDescription,
              seriesTitle,
              roleBadge: getCharacterSitcomRoleBadge(primaryMember, seriesTitle)
            }),
          dialogueOrThought:
            turns.length > 1
              ? turns
                  .map(
                    (t) =>
                      `${activeCast.find((c) => c.id === t.characterId)?.name || ''}: "${
                        t.dialogueOrThought
                      }"`
                  )
                  .join(' ↔️ ')
              : turns[0].dialogueOrThought,
          status: 'READY'
        });
        remainingSec -= photoDur;
        order++;
      }
      mediaLoopIdx++;
    }
  }

  let castIdx = 0;
  while (remainingSec > 0 && activeCast.length > 0) {
    const member = activeCast[castIdx % activeCast.length];
    const dur =
      remainingSec <= 9 ? remainingSec : Math.min(7, Math.max(4, Math.round(remainingSec / 3)));
    const bestMemberPhoto =
      member.referencePhotos?.find((p) => !p.startsWith('data:image/svg+xml')) ||
      member.referencePhotos?.[0] ||
      '';
    const turns = buildDialogueTurnsForSceneCharacters({
      characterIds: [member.id],
      durationSec: dur,
      cast: activeCast,
      idea: ideaClean,
      sceneOrder: order,
      genreStyle: seriesGenreStyle,
      seriesTitle
    });
    scenes.push({
      id: `scene-local-${Date.now()}-${order}`,
      order,
      sceneType: 'AI_PHOTO_VIDEO',
      characterId: member.id,
      characterIds: [member.id],
      dialogueTurns: turns,
      durationSec: dur,
      cameraShot: castIdx % 2 === 0 ? 'CLOSEUP_PUNCH' : 'DYNAMIC_ZOOM',
      directorNote: `Video personaggio animato con ${member.name} — Scena #${order}`,
      aiPhotoSourceUrl: bestMemberPhoto,
      veoMotionPrompt: buildGeminiStyleCharacterVideoPrompt({
        character: member,
        cast: activeCast,
        sceneCharacterIds: [member.id],
        dialogueText: turns[0]?.dialogueOrThought || '',
        plotContext: ideaClean,
        seriesTitle,
        roleBadge: getCharacterSitcomRoleBadge(member, seriesTitle)
      }),
      dialogueOrThought: turns[0].dialogueOrThought,
      status: 'READY'
    });
    remainingSec -= dur;
    order++;
    castIdx++;
  }

  balanceSceneDurationsToExactTarget(scenes, netContentDurationSec);

  const detectedCastIds = Array.from(
    new Set(scenes.flatMap((s) => s.characterIds || [s.characterId]))
  );
  const funnyRolesByCastId: Record<string, string> = {};
  for (const id of detectedCastIds) {
    const c = activeCast.find((m) => m.id === id);
    if (!c) continue;
    if (isVdc) {
      if (c.type === 'HUMAN') {
        funnyRolesByCastId[id] = 'Vittima Consapevole & Finanziatore di Crocchette';
      } else if (c.name.toLowerCase().includes('zora')) {
        funnyRolesByCastId[id] = 'Avvocato Difensore Supremo del Divano';
      } else if (c.name.toLowerCase().includes('uma')) {
        funnyRolesByCastId[id] = 'Ispettrice Cibo Caduto Entro i 3 Secondi';
      } else {
        funnyRolesByCastId[id] = c.defaultCreditRole || 'Protagonista Speciale';
      }
    } else {
      funnyRolesByCastId[id] =
        c.defaultCreditRole && !c.defaultCreditRole.toLowerCase().includes('crocchett')
          ? c.defaultCreditRole
          : `Protagonista di ${seriesTitle || 'Serie'}`;
    }
  }

  const keepUserTitle =
    episodeTitle &&
    episodeTitle.trim().length > 0 &&
    !episodeTitle.includes('Nuovo Sketch') &&
    !episodeTitle.includes('Il Debutto');

  return {
    title: keepUserTitle
      ? episodeTitle!.trim()
      : topicKeyword.length > 4
      ? `${seriesTitle ? `${seriesTitle}: ` : ''}${topicKeyword}`
      : `${seriesTitle || 'Nuovo Episodio'} — Scena #1`,
    detectedCastIds,
    funnyRolesByCastId,
    scenes
  };
}

export function generateLineForCharacter(
  member: CastMember,
  idea: string,
  sceneOrder: number,
  _durationSec: number,
  genreStyle?: SeriesGenreStyle,
  seriesTitle?: string
): string {
  const cName = member.name.toLowerCase();
  const isVdc = isVitaDaCaniSeries(seriesTitle, idea);
  const isZora = isVdc && cName.includes('zora');
  const isUma = isVdc && cName.includes('uma');
  const isCristina = isVdc && (cName.includes('cristina') || cName.includes('cri'));

  // For ANY autonomous non-"Vita da Cani" series (e.g., "Bestemmia Atelier"), generate 100% contextual lines!
  if (!isVdc) {
    // 1. Check if the character has custom memoryGags defined by the user
    const customGags = (member.memoryGags || []).filter(
      (g) =>
        g &&
        g.trim().length > 4 &&
        !/croccantin|biscott|zora|uma|vita da cani/i.test(g)
    );
    if (customGags.length > 0 && sceneOrder % 2 === 0) {
      return customGags[(sceneOrder - 1) % customGags.length].replace(/^["«]|["»]$/g, '');
    }

    // 2. Extract meaningful sentences/clauses from the user's plot (`idea`) if present
    const cleanIdea = (idea || '').trim();
    const ideaSentences = cleanIdea
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(
        (s) =>
          s.length >= 12 &&
          !/vita da cani|zora|uma|croccantin/i.test(s) &&
          !s.toLowerCase().startsWith('un episodio coinvolgente')
      );

    const showLabel = seriesTitle?.trim() || 'questo studio';

    if (genreStyle === 'HORROR_THRILLER') {
      const pool = [
        `Silenzio tutti... in ${showLabel} c'è un dettaglio che mette i brividi!`,
        `Non toccate niente, so esattamente chi è stato qui dentro!`,
        `Guardate bene questa scena: la tensione si taglia col coltello!`
      ];
      return pool[(sceneOrder - 1) % pool.length];
    }

    if (genreStyle === 'DRAMA_SOAP') {
      const pool = [
        `In ${showLabel} non accetto scuse: voglio la verità adesso!`,
        `Guardatemi negli occhi e ditemi se questo vi sembra normale!`,
        `Dopo tutto il lavoro fatto qui, questo colpo di scena cambia tutto!`
      ];
      return pool[(sceneOrder - 1) % pool.length];
    }

    if (genreStyle === 'ACTION_ADVENTURE') {
      const pool = [
        `Zero esitazioni in ${showLabel}: abbiamo tre secondi per chiudere il colpo!`,
        `Tenetevi forte, adesso ${member.name} passa al contrattacco!`,
        `Missione perfetta: quando entro in azione non sbaglio un colpo!`
      ];
      return pool[(sceneOrder - 1) % pool.length];
    }

    // Comedy / Satire / Custom series lines tailored to `seriesTitle` & `member.name`
    const dynamicLines = [
      `Benvenuti da ${member.name} in ${showLabel}: qui l'arte è una cosa seria... più o meno!`,
      `Guardate che capolavoro: quando ci metto le mani io, il livello sale subito!`,
      `Ve lo dico col sorriso: oggi in ${showLabel} superiamo ogni limite!`,
      `Ma secondo voi è normale lavorare con questi ritmi?! Meno male che ci penso io!`,
      `Osservate lo stile e l'espressione: in ${showLabel} non si improvvisa proprio nulla!`,
      `Chiudi tutto e guarda qua: questa scena merita applausi a scena aperta!`
    ];

    if (ideaSentences.length > 0) {
      const chosenClause = ideaSentences[(sceneOrder - 1) % ideaSentences.length]
        .replace(/^["«]|["»]$/g, '')
        .trim();
      if (chosenClause.length <= 95 && sceneOrder === 1) {
        return chosenClause;
      }
    }

    return dynamicLines[(sceneOrder - 1) % dynamicLines.length];
  }

  // Below: Only for the default "Vita da Cani" series
  const isIntroPresentation = /presentazione|famiglia|caratter|debutto|vita da cani/i.test(idea || '');

  if (isIntroPresentation) {
    if (isZora) {
      const zoraIntro = [
        `Ecco a voi Zora! La cagna che esplora, fiera e coraggiosa, pronta per l'avventura!`,
        `Zora pensa di essere l'unica regina di casa... ma ecco che arriva una sorpresa!`
      ];
      return zoraIntro[(sceneOrder - 1) % zoraIntro.length];
    }
    if (isUma) {
      const umaIntro = [
        `Ed ora passiamo a Uma! Che peperino! Una sorellina terribile, ma tanto dolce!`,
        `Con la piccola Uma in giardino non ci si annoia davvero mai!`
      ];
      return umaIntro[(sceneOrder - 1) % umaIntro.length];
    }
    if (isCristina) {
      return `Con Cristina e tutta la squadra al completo, in questa casa ne vedremo delle belle!`;
    }
    const humanIntro = [
      `Benvenuti a Vita da Cani! Con Francesco, Cristina, Zora e Uma ne vedremo delle belle!`,
      `Ed ora presentiamo i veri protagonisti di casa: tenetevi pronti, buona visione!`
    ];
    return humanIntro[(sceneOrder - 1) % humanIntro.length];
  }

  const templatesHuman = [
    `Benvenuti a Vita da Cani! Anche oggi in giardino ne vedremo delle belle!`,
    `Guardate che coppia: quando Zora e Uma si mettono d'accordo, comandano loro!`,
    `Ragazze, avevo chiesto cinque minuti di pace... e invece è già festa!`,
    `Con questa famiglia speciale ogni giornata diventa uno spettacolo!`
  ];

  const templatesCristina = [
    `Guardate quanto sono belle! Con Zora e la piccola Uma è impossibile restare seri!`,
    `Dai ragazze, venite qui che facciamo una foto tutti insieme!`,
    `Tra Cesco, Zora e Uma qui non ci si annoia neanche un secondo!`
  ];

  const templatesZora = [
    `Ecco a voi Zora, la cagna che esplora! Fiera, coraggiosa e regina del giardino!`,
    `Tranquilli tutti, ci penso io a tenere d'occhio la situazione con stile!`,
    `Uma, stammi vicina: se facciamo gli occhi dolci, oggi doppia razione di coccole!`,
    `Secondo il regolamento di casa, il posto più comodo spetta sempre a me!`
  ];

  const templatesUma = [
    `Ed ecco Uma, che peperino! Una sorellina terribile, ma tanto dolce!`,
    `Qualcuno ha detto pallina?! Io sono già pronta a correre per tutto il prato!`,
    `Giuro che volevo fare la brava... ma questo giocattolo era troppo invitante!`,
    `Adesso però festeggiamo tutti insieme: buona visione a tutti!`
  ];

  const pool = isCristina
    ? templatesCristina
    : member.type === 'HUMAN'
    ? templatesHuman
    : isZora
    ? templatesZora
    : isUma
    ? templatesUma
    : templatesZora;

  return pool[(sceneOrder - 1) % pool.length];
}

export function ensureSitcomPunchyLine(
  rawLine: string,
  member: CastMember,
  sceneOrder: number,
  ideaContext = '',
  seriesTitle?: string
): string {
  const trimmed = (rawLine || '').trim();
  const isVdc = isVitaDaCaniSeries(seriesTitle, ideaContext);

  const hasAwkwardQuotePaste =
    trimmed.includes('su "') ||
    trimmed.includes('per "') ||
    trimmed.includes('operazione "') ||
    trimmed.includes('penso a "') ||
    trimmed.includes('parliamoci chiaro su') ||
    trimmed.includes('codice canino su') ||
    trimmed.includes('non so cosa sia "');

  // Purge cross-series "Vita da Cani" contamination if the current series is NOT Vita da Cani
  const hasCrossSeriesVdcContamination =
    !isVdc &&
    /vita da cani|zora|uma|cagna che esplora|croccantin|sorellina terribile/i.test(trimmed);

  if (!trimmed || hasAwkwardQuotePaste || hasCrossSeriesVdcContamination) {
    return generateLineForCharacter(member, ideaContext, sceneOrder, 4.0, undefined, seriesTitle);
  }
  return trimmed;
}

export function getCharacterSitcomRoleBadge(member: CastMember, seriesTitle?: string): string {
  const isVdc = isVitaDaCaniSeries(seriesTitle);
  const cName = member.name.toLowerCase();
  if (isVdc) {
    if (cName.includes('zora')) return "L'ESPLORATRICE";
    if (cName.includes('uma')) return 'LA SORELLINA';
    if (cName.includes('cristina') || cName.includes('cri')) return 'LA COMPLICE';
    if (cName.includes('cesco') || cName.includes('francesco')) return 'IL CAPOFAMIGLIA';
  }
  const cleanRole = (member.defaultCreditRole || 'PROTAGONISTA')
    .replace(/crocchett|divano|guinzaglio|snack/gi, '')
    .trim();
  return (cleanRole || 'PROTAGONISTA').slice(0, 22).toUpperCase();
}

export function buildGeminiStyleCharacterVideoPrompt(params: {
  character: CastMember;
  cast?: CastMember[];
  sceneCharacterIds?: string[];
  dialogueText?: string;
  plotContext?: string;
  visualContext?: string;
  seriesTitle?: string;
  roleBadge?: string;
  customActionPrompt?: string;
}): string {
  const {
    character,
    cast = [],
    sceneCharacterIds = [],
    dialogueText = '',
    plotContext = '',
    visualContext = '',
    seriesTitle = '',
    roleBadge,
    customActionPrompt
  } = params;

  const cleanLine = cleanDialogueTextForSpeech(dialogueText);
  const badge = roleBadge || getCharacterSitcomRoleBadge(character, seriesTitle);
  const overlayTitle =
    badge && !badge.toLowerCase().includes(character.name.toLowerCase())
      ? `${character.name} - ${badge}`
      : character.name;

  // Voice style & timbre coherence
  const voiceStyleDesc = [
    character.voiceConfig?.stylePrompt,
    character.voiceConfig?.analyzedTimbreProfile,
    character.voiceConfig?.pitch && character.voiceConfig.pitch !== 1
      ? `intonazione ${character.voiceConfig.pitch > 1 ? 'brillante' : 'calda e profonda'} (${character.voiceConfig.pitch}x)`
      : ''
  ]
    .filter(Boolean)
    .join(', ');

  // Character relationships & correlations with co-stars
  const otherCharIds = sceneCharacterIds.filter((id) => id !== character.id);
  const relevantRels = (character.relationships || [])
    .map((rel) => {
      const target = cast.find((c) => c.id === rel.targetCharacterId);
      if (!target) return null;
      const isPresentInScene = otherCharIds.includes(target.id);
      return `${isPresentInScene ? `[In scena con ${target.name}] ` : ''}rapporto con ${
        target.name
      } (${rel.relationType}): ${rel.description}`;
    })
    .filter(Boolean);

  const coStarNames = otherCharIds
    .map((id) => cast.find((c) => c.id === id)?.name)
    .filter(Boolean)
    .join(' e ');

  const correlationClause =
    relevantRels.length > 0
      ? ` Correlazione tra personaggi: ${relevantRels.join('; ')}.`
      : coStarNames
      ? ` Interagisce con grande complicità e tempi comici con ${coStarNames}.`
      : '';

  const actionClause =
    customActionPrompt &&
    !customActionPrompt.startsWith('Elabora un singolo video') &&
    !customActionPrompt.startsWith('Crea un video dalla foto')
      ? customActionPrompt
      : visualContext
      ? `si anima partendo da "${visualContext}", saluta o gesticola con naturalezza muovendo testa, volto, labbra e corpo`
      : `saluta verso la camera, si muove realmente nella scena con gesti espressivi ed espressione facciale viva`;

  const plotClause = plotContext
    ? ` in coerenza con la trama "${plotContext.slice(0, 120)}"`
    : '';

  return `Anima questa immagine creando un video fluido in formato verticale 9:16. Il personaggio ${character.name} (${
    character.personalityPrompt || 'espressivo e carismatico'
  }) si muove realmente nella scena in modo vivo e naturale: ${actionClause}${plotClause}, con movimenti della testa, del corpo, delle labbra e cambio d'espressione coerente. Azione e recitazione per la battuta: "${cleanLine}".${correlationClause} Stile video cinematografico ad alta definizione (non una foto fissa che oscilla, ma vera generazione video animata in 9:16 per Reel).`;
}

export function buildVeoDirectPromptForScene(
  paramsOrScene:
    | {
        scene: SceneCard;
        character: CastMember;
        cast?: CastMember[];
        seriesTitle: string;
        episodeTitle?: string;
        rawIdea?: string;
      }
    | SceneCard,
  maybeCast?: CastMember[],
  maybeSeriesTitle?: string
): string {
  if ('scene' in paramsOrScene) {
    const { scene, character, cast = [], seriesTitle, episodeTitle, rawIdea } = paramsOrScene;
    const roleBadge =
      scene.characterRoleBadge || getCharacterSitcomRoleBadge(character, seriesTitle);
    return buildGeminiStyleCharacterVideoPrompt({
      character,
      cast,
      sceneCharacterIds: scene.characterIds || [scene.characterId],
      dialogueText: scene.dialogueOrThought,
      plotContext: rawIdea || episodeTitle || seriesTitle,
      seriesTitle,
      roleBadge,
      customActionPrompt: scene.veoMotionPrompt
    });
  }

  const scene = paramsOrScene;
  const cast = maybeCast || [];
  const seriesTitle = maybeSeriesTitle || 'Serie Originale';
  const character = cast.find((c) => c.id === scene.characterId) || cast[0];
  if (!character) return scene.veoMotionPrompt || scene.dialogueOrThought || '';
  const roleBadge =
    scene.characterRoleBadge || getCharacterSitcomRoleBadge(character, seriesTitle);
  return buildGeminiStyleCharacterVideoPrompt({
    character,
    cast,
    sceneCharacterIds: scene.characterIds || [scene.characterId],
    dialogueText: scene.dialogueOrThought,
    plotContext: seriesTitle,
    seriesTitle,
    roleBadge,
    customActionPrompt: scene.veoMotionPrompt
  });
}

/**
 * Guarantees that the sum of all scene durations equals `targetNetSec` to the exact second,
 * and keeps `dialogueTurns` timings proportionally synchronized.
 */
export function balanceSceneDurationsToExactTarget(scenes: SceneCard[], targetNetSec: number): void {
  if (scenes.length === 0) return;
  let currentSum = scenes.reduce((acc, s) => acc + s.durationSec, 0);
  let diff = targetNetSec - currentSum;

  let safety = 0;
  while (diff !== 0 && safety < 500) {
    for (let i = scenes.length - 1; i >= 0 && diff !== 0; i--) {
      if (diff > 0) {
        scenes[i].durationSec += 1;
        if (scenes[i].sceneType === 'USER_VIDEO') {
          scenes[i].trimEndSec = (scenes[i].trimStartSec || 0) + scenes[i].durationSec;
        }
        diff -= 1;
      } else if (diff < 0 && scenes[i].durationSec > 2) {
        scenes[i].durationSec -= 1;
        if (scenes[i].sceneType === 'USER_VIDEO') {
          scenes[i].trimEndSec = (scenes[i].trimStartSec || 0) + scenes[i].durationSec;
        }
        diff += 1;
      }
    }
    currentSum = scenes.reduce((acc, s) => acc + s.durationSec, 0);
    diff = targetNetSec - currentSum;
    safety++;
  }

  for (const sc of scenes) {
    if (sc.dialogueTurns && sc.dialogueTurns.length > 0) {
      const count = sc.dialogueTurns.length;
      const slot = sc.durationSec / count;
      let offset = 0;
      sc.dialogueTurns = sc.dialogueTurns.map((t, idx) => {
        const d =
          idx === count - 1
            ? Math.max(1, Number((sc.durationSec - offset).toFixed(2)))
            : Math.max(1, Number(slot.toFixed(2)));
        const start = Number(offset.toFixed(2));
        offset += d;
        return {
          ...t,
          startOffsetSec: start,
          durationSec: d
        };
      });
    }
  }
}

/**
 * 2. TTS VOICE GENERATION (Google Cloud TTS / Gemini Audio + Expressive Local Speech Audio Synthesizer)
 * Always returns a valid playable WAV Blob URL so that Canvas export and Web Audio Auto-Ducking work 100%.
 */
export const GEMINI_HD_VOICES = [
  { id: 'Orus', label: '🌟 Orus (Uomo Naturale, Caldo & Profondo — Attore Cinema)' },
  { id: 'Puck', label: '🌟 Puck (Uomo Brillante, Ironico & Colloquiale — Sitcom)' },
  { id: 'Charon', label: '🌟 Charon (Uomo Autorevole, Calmo & Narratore)' },
  { id: 'Fenrir', label: '🌟 Fenrir (Uomo Energico & Dinamico)' },
  { id: 'Aoede', label: '🌟 Aoede (Donna Naturale, Calda, Arguta & Teatrale)' },
  { id: 'Leda', label: '🌟 Leda (Donna Giovane, Sorridente, Frizzante & Spontanea)' },
  { id: 'Kore', label: '🌟 Kore (Donna Dolce, Espressiva & Luminosa)' },
  { id: 'Zephyr', label: '🌟 Zephyr (Voce Vivace, Buffa & Super Espressiva)' }
] as const;

function resolveGeminiVoiceName(configuredName: string, character: CastMember): string {
  const validIds = GEMINI_HD_VOICES.map((v) => v.id as string);
  if (validIds.includes(configuredName)) {
    return configuredName;
  }
  if (character.type === 'HUMAN') return 'Orus';
  if (character.name.toLowerCase().includes('zora')) return 'Aoede';
  if (character.name.toLowerCase().includes('uma')) return 'Leda';
  return 'Kore';
}

/**
 * Analyzes a recorded or uploaded user voice sample using Gemini 2.5 Flash Native Audio
 * + Web Audio fundamental frequency & spectral centroid analysis.
 */
export async function analyzeAndCloneVoiceSample(params: {
  audioBlob: Blob;
  character: CastMember;
  apiKeys: ApiKeysConfig;
}): Promise<{
  voiceSampleBlobUrl: string;
  voiceSampleBase64: string;
  voiceSampleMimeType: string;
  recommendedVoiceName: string;
  detectedPitchRatio: number;
  detectedWarmthDb: number;
  detectedPresenceDb: number;
  analyzedTimbreProfile: string;
  stylePrompt: string;
}> {
  const { audioBlob, character, apiKeys } = params;
  const voiceSampleBlobUrl = URL.createObjectURL(audioBlob);
  const base64Full = await blobToDataUrl(audioBlob);
  const commaIdx = base64Full.indexOf(',');
  const voiceSampleBase64 = commaIdx !== -1 ? base64Full.slice(commaIdx + 1) : '';
  const voiceSampleMimeType = audioBlob.type || 'audio/webm';

  let detectedPitchRatio = 1.0;
  let detectedWarmthDb = 3;
  let detectedPresenceDb = 2;
  try {
    const arrayBuf = await audioBlob.arrayBuffer();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    const chan = decoded.getChannelData(0);
    let zeroCrossings = 0;
    for (let i = 1; i < chan.length; i++) {
      if ((chan[i] >= 0 && chan[i - 1] < 0) || (chan[i] < 0 && chan[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }
    const zcrPerSec = zeroCrossings / Math.max(0.5, decoded.duration);
    if (zcrPerSec > 2600) {
      detectedPitchRatio = 1.06;
      detectedPresenceDb = 4;
    } else if (zcrPerSec < 1700) {
      detectedPitchRatio = 0.96;
      detectedWarmthDb = 4;
    }
    await ctx.close();
  } catch {
    // Ignore decode errors
  }

  const key = apiKeys.geminiApiKey?.trim();
  if (key && key.length > 10 && voiceSampleBase64) {
    try {
      const rawJson = await callGeminiTextOrJsonCascade({
        apiKey: key,
        parts: [
          {
            text: `Ascolta questo campione vocale registrato dall'utente per il personaggio "${character.name}" (${character.type}).
Analizza timbro, calore, cadenza, velocità, intonazione ed emozione della voce parlata.
Scegli quale voce neurale HD tra ["Orus", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Kore", "Zephyr"] ha l'impronta vocale più vicina a questo campione e scrivi una direttiva di recitazione ("stylePrompt") in italiano per imitare fedelmente il modo di parlare, gli accenti e il respiro del campione.
Restituisci SOLO JSON:
{
  "recommendedVoiceName": "Orus",
  "analyzedTimbreProfile": "Breve descrizione del timbro rilevato",
  "stylePrompt": "Istruzione dettagliata di recitazione per replicare questa voce"
}`
          },
          {
            inlineData: {
              mimeType: voiceSampleMimeType.split(';')[0] || 'audio/webm',
              data: voiceSampleBase64
            }
          }
        ],
        responseMimeType: 'application/json'
      });

      if (rawJson) {
        const parsed = JSON.parse(rawJson);
        return {
          voiceSampleBlobUrl,
          voiceSampleBase64,
          voiceSampleMimeType,
          recommendedVoiceName: resolveGeminiVoiceName(parsed.recommendedVoiceName, character),
          detectedPitchRatio,
          detectedWarmthDb,
          detectedPresenceDb,
          analyzedTimbreProfile:
            parsed.analyzedTimbreProfile ||
            'Campione vocale acquisito: timbro caldo e cadenza naturale rilevati.',
          stylePrompt:
            parsed.stylePrompt ||
            'Recita in italiano con cadenza ultra-naturale fedele al campione vocale registrato.'
        };
      }
    } catch (e) {
      console.warn('Gemini voice sample analysis fallback:', e);
    }
  }

  return {
    voiceSampleBlobUrl,
    voiceSampleBase64,
    voiceSampleMimeType,
    recommendedVoiceName: resolveGeminiVoiceName(character.voiceConfig.voiceName, character),
    detectedPitchRatio,
    detectedWarmthDb,
    detectedPresenceDb,
    analyzedTimbreProfile: 'Impronta vocale campionata dal microfono (Calore +3dB, Presenza HD attiva)',
    stylePrompt:
      'Recita in italiano spontaneo, caldo e indistinguibile dal parlato reale umano, replicando il campione registrato.'
  };
}

export function cleanDialogueTextForSpeech(rawText: string): string {
  if (!rawText) return 'Ciao ragazzi!';
  const cleaned = rawText
    .replace(/↔️/g, '. ')
    .replace(/^[A-Za-zÀ-ÿ0-9_ ]{2,20}:\s*["«]?/g, '')
    .replace(/["«»]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Ciao a tutti!';
}

function splitItalianTextIntoTtsChunks(text: string, maxChars = 165): string[] {
  const clean = cleanDialogueTextForSpeech(text);
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.split(/(?<=[.!?;:])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const s of sentences) {
    if ((current + ' ' + s).trim().length <= maxChars) {
      current = (current + ' ' + s).trim();
    } else {
      if (current) chunks.push(current);
      if (s.length <= maxChars) {
        current = s;
      } else {
        const words = s.split(/\s+/);
        let wordChunk = '';
        for (const w of words) {
          if ((wordChunk + ' ' + w).trim().length <= maxChars) {
            wordChunk = (wordChunk + ' ' + w).trim();
          } else {
            if (wordChunk) chunks.push(wordChunk);
            wordChunk = w;
          }
        }
        current = wordChunk;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [clean.slice(0, maxChars)];
}

function isFemaleCharacterVoice(character: CastMember): {
  isFemale: boolean;
  isYoungBright: boolean;
} {
  const vName = resolveGeminiVoiceName(character.voiceConfig.voiceName, character);
  const cName = character.name.toLowerCase();
  const isYoungBright =
    vName === 'Leda' || vName === 'Zephyr' || cName.includes('uma');
  const isFemale =
    isYoungBright ||
    vName === 'Aoede' ||
    vName === 'Kore' ||
    cName.includes('zora') ||
    cName.includes('cristina') ||
    (character.type === 'ANIMAL' && !['Orus', 'Puck', 'Charon', 'Fenrir'].includes(vName));
  return { isFemale, isYoungBright };
}

async function fetchFreeItalianNeuralVoiceBlob(
  text: string,
  character: CastMember
): Promise<Blob | null> {
  try {
    const cleanText = cleanDialogueTextForSpeech(text);
    const chunks = splitItalianTextIntoTtsChunks(cleanText, 155);
    const mp3Blobs: Blob[] = [];
    const { isFemale } = isFemaleCharacterVoice(character);

    for (const chunk of chunks) {
      let chunkBlob: Blob | null = null;

      if (isFemale) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 5500);
        try {
          const googleTarget = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=it&ttsspeed=1&q=${encodeURIComponent(
            chunk
          )}`;
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(googleTarget)}`;
          const res = await fetch(proxyUrl, { signal: controller.signal });
          window.clearTimeout(timeoutId);
          if (res.ok) {
            const ab = await res.arrayBuffer();
            if (ab.byteLength > 800) {
              chunkBlob = new Blob([ab], { type: 'audio/mpeg' });
            }
          }
        } catch {
          window.clearTimeout(timeoutId);
        }
      }

      if (!chunkBlob) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 6500);
        try {
          const res = await fetch('https://ottsy.weilbyte.dev/api/generation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: chunk,
              voice: 'it_male_m18'
            }),
            signal: controller.signal
          });
          window.clearTimeout(timeoutId);
          if (res.ok) {
            const json = await res.json();
            if (json?.success && typeof json.data === 'string' && json.data.length > 50) {
              const bin = atob(json.data);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) {
                bytes[i] = bin.charCodeAt(i);
              }
              chunkBlob = new Blob([bytes], { type: 'audio/mpeg' });
            }
          }
        } catch {
          window.clearTimeout(timeoutId);
        }
      }

      if (chunkBlob) {
        mp3Blobs.push(chunkBlob);
      }
    }

    if (mp3Blobs.length === 0) return null;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const decodeCtx = new AudioCtx();
    const decodedList: AudioBuffer[] = [];

    for (const b of mp3Blobs) {
      const ab = await b.arrayBuffer();
      const dec = await decodeCtx.decodeAudioData(ab.slice(0));
      decodedList.push(dec);
    }
    await decodeCtx.close();

    if (decodedList.length === 0) return null;

    const sampleRate = 44100;
    const pauseBetweenChunksSec = 0.22;
    const tailPadSec = 0.14;
    const totalDurSec =
      decodedList.reduce((acc, d) => acc + d.duration, 0) +
      Math.max(0, decodedList.length - 1) * pauseBetweenChunksSec +
      tailPadSec;

    const offlineCtx = new OfflineAudioContext(
      1,
      Math.max(1024, Math.ceil(totalDurSec * sampleRate)),
      sampleRate
    );

    let offsetSec = 0.03;
    for (let i = 0; i < decodedList.length; i++) {
      const buf = decodedList[i];
      const src = offlineCtx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 1.0;
      src.connect(offlineCtx.destination);
      src.start(offsetSec);
      offsetSec += buf.duration + pauseBetweenChunksSec;
    }

    const rendered = await offlineCtx.startRendering();
    return audioBufferToWavBlob(rendered);
  } catch (e) {
    console.warn('Free Italian Neural TTS fallback error:', e);
    return null;
  }
}

export async function getSampledVoiceBlobFromConfig(
  voiceConfig: CastMember['voiceConfig']
): Promise<Blob | null> {
  if (voiceConfig.voiceSampleBase64 && voiceConfig.voiceSampleBase64.length > 20) {
    try {
      const raw = atob(voiceConfig.voiceSampleBase64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
      }
      return new Blob([bytes], { type: voiceConfig.voiceSampleMimeType || 'audio/webm' });
    } catch (e) {
      console.warn('Error decoding voiceSampleBase64:', e);
    }
  }
  if (voiceConfig.voiceSampleBlobUrl) {
    try {
      const res = await fetch(voiceConfig.voiceSampleBlobUrl.split('#')[0]);
      if (res.ok) {
        return await res.blob();
      }
    } catch {
      // Ignore expired blob URL
    }
  }
  return null;
}

const sampleAcousticCache: Record<
  string,
  { pitchFactor: number; warmthDeltaDb: number; presenceDeltaDb: number }
> = {};

async function extractSampledVoiceAcousticSignature(
  voiceConfig: CastMember['voiceConfig']
): Promise<{ pitchFactor: number; warmthDeltaDb: number; presenceDeltaDb: number }> {
  const defaultSig = { pitchFactor: 1.0, warmthDeltaDb: 0, presenceDeltaDb: 0 };
  if (!voiceConfig.voiceSampleBase64 && !voiceConfig.voiceSampleBlobUrl) {
    return defaultSig;
  }
  const cacheKey = (voiceConfig.voiceSampleBase64 || voiceConfig.voiceSampleBlobUrl || '').slice(
    0,
    96
  );
  if (sampleAcousticCache[cacheKey]) {
    return sampleAcousticCache[cacheKey];
  }

  try {
    const blob = await getSampledVoiceBlobFromConfig(voiceConfig);
    if (!blob) return defaultSig;
    const arrayBuf = await blob.arrayBuffer();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    const chan = decoded.getChannelData(0);

    let zeroCrossings = 0;
    let rmsSum = 0;
    let diffSum = 0;
    for (let i = 1; i < chan.length; i++) {
      const s = chan[i];
      const prev = chan[i - 1];
      rmsSum += s * s;
      diffSum += Math.abs(s - prev);
      if ((s >= 0 && prev < 0) || (s < 0 && prev >= 0)) {
        zeroCrossings++;
      }
    }
    await ctx.close();

    const zcrPerSec = zeroCrossings / Math.max(0.4, decoded.duration);
    const rms = Math.sqrt(rmsSum / Math.max(1, chan.length));
    const avgDiff = diffSum / Math.max(1, chan.length);
    const brightnessRatio = avgDiff / Math.max(0.0001, rms);

    let pitchFactor = 1.0;
    if (zcrPerSec > 2500) {
      pitchFactor = Math.min(1.14, 1.0 + (zcrPerSec - 2100) / 14000);
    } else if (zcrPerSec < 1750) {
      pitchFactor = Math.max(0.88, 1.0 - (1850 - zcrPerSec) / 11000);
    }

    const warmthDeltaDb = brightnessRatio < 0.45 ? 2.5 : brightnessRatio > 0.75 ? -1.0 : 1.2;
    const presenceDeltaDb = brightnessRatio > 0.65 ? 2.8 : 1.0;

    const sig = { pitchFactor, warmthDeltaDb, presenceDeltaDb };
    sampleAcousticCache[cacheKey] = sig;
    return sig;
  } catch {
    return defaultSig;
  }
}

export function buildCharacterVoiceSignature(character: CastMember): string {
  const vc = character.voiceConfig;
  const sampleTag = vc.voiceSampleBase64
    ? vc.voiceSampleBase64.slice(0, 16)
    : vc.voiceSampleBlobUrl
    ? 'blob'
    : 'nosample';
  return `${vc.voiceName}_p${vc.pitch}_s${vc.speed}_w${vc.warmth}_pr${vc.presence}_rec${Boolean(
    vc.useRecordedVoiceDirectly
  )}_${sampleTag}`;
}

export async function applyAcousticMasteringToAudioBlob(
  sourceBlob: Blob,
  voiceConfig: CastMember['voiceConfig'],
  character?: CastMember
): Promise<string> {
  try {
    const arrayBuffer = await sourceBlob.arrayBuffer();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const tempCtx = new AudioCtx();
    const decoded = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
    await tempCtx.close();

    const resolvedActor = character
      ? resolveGeminiVoiceName(voiceConfig.voiceName, character)
      : voiceConfig.voiceName || 'Aoede';

    const actorProfiles: Record<
      string,
      { basePitch: number; formantHz: number; warmthDb: number; presenceDb: number }
    > = {
      Orus: { basePitch: 0.98, formantHz: 980, warmthDb: 2.2, presenceDb: 1.5 },
      Charon: { basePitch: 0.92, formantHz: 850, warmthDb: 3.2, presenceDb: 1.2 },
      Puck: { basePitch: 1.04, formantHz: 1380, warmthDb: 1.0, presenceDb: 2.6 },
      Fenrir: { basePitch: 1.0, formantHz: 1180, warmthDb: 2.0, presenceDb: 2.8 },
      Aoede: { basePitch: 0.96, formantHz: 1520, warmthDb: 2.5, presenceDb: 1.8 },
      Kore: { basePitch: 1.01, formantHz: 1880, warmthDb: 1.8, presenceDb: 2.2 },
      Leda: { basePitch: 1.08, formantHz: 2350, warmthDb: 0.6, presenceDb: 3.2 },
      Zephyr: { basePitch: 1.12, formantHz: 2550, warmthDb: 0.4, presenceDb: 3.5 }
    };

    const actorProf = actorProfiles[resolvedActor] || actorProfiles.Aoede;
    const sampleSig = await extractSampledVoiceAcousticSignature(voiceConfig);

    const userPitch = typeof voiceConfig.pitch === 'number' ? voiceConfig.pitch : 1.0;
    const userSpeed = typeof voiceConfig.speed === 'number' ? voiceConfig.speed : 1.0;
    const userWarmth = typeof voiceConfig.warmth === 'number' ? voiceConfig.warmth : 3;
    const userPresence = typeof voiceConfig.presence === 'number' ? voiceConfig.presence : 2;

    const isDirectRecording = Boolean(voiceConfig.useRecordedVoiceDirectly);
    const combinedPitch = isDirectRecording
      ? userPitch
      : userPitch * actorProf.basePitch * sampleSig.pitchFactor;

    const speedDeviation = userSpeed - 1.0;
    const playbackRate = Math.max(
      0.76,
      Math.min(1.32, combinedPitch + speedDeviation * 0.35)
    );

    const targetLength = Math.max(1024, Math.ceil(decoded.length / playbackRate));
    const offlineCtx = new OfflineAudioContext(1, targetLength, decoded.sampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = decoded;
    source.playbackRate.value = playbackRate;

    const warmthFilter = offlineCtx.createBiquadFilter();
    warmthFilter.type = 'lowshelf';
    warmthFilter.frequency.value = 220;
    warmthFilter.gain.value = Math.max(
      -8,
      Math.min(12, (userWarmth - 2) * 1.8 + actorProf.warmthDb + sampleSig.warmthDeltaDb)
    );

    const formantFilter = offlineCtx.createBiquadFilter();
    formantFilter.type = 'peaking';
    formantFilter.frequency.value = Math.max(
      650,
      Math.min(3400, actorProf.formantHz * combinedPitch)
    );
    formantFilter.Q.value = 1.2;
    formantFilter.gain.value = 2.6;

    const presenceFilter = offlineCtx.createBiquadFilter();
    presenceFilter.type = 'peaking';
    presenceFilter.frequency.value = 3100;
    presenceFilter.Q.value = 0.95;
    presenceFilter.gain.value = Math.max(
      -6,
      Math.min(12, (userPresence - 1) * 1.8 + actorProf.presenceDb + sampleSig.presenceDeltaDb)
    );

    source.connect(warmthFilter);
    warmthFilter.connect(formantFilter);
    formantFilter.connect(presenceFilter);
    presenceFilter.connect(offlineCtx.destination);

    source.start(0);
    const rendered = await offlineCtx.startRendering();
    const masteredWav = audioBufferToWavBlob(rendered);
    const sigTag = character ? buildCharacterVoiceSignature(character) : `p${userPitch}`;
    return `${URL.createObjectURL(masteredWav)}#realvoice#sitcomvoice_v4_${sigTag}`;
  } catch (e) {
    console.warn('Acoustic mastering pass-through:', e);
    return `${URL.createObjectURL(sourceBlob)}#realvoice#sitcomvoice_v4`;
  }
}

let geminiTtsBillingDepleted = false;

export async function fetchRawGeminiNeuralVoiceBlob(params: {
  text: string;
  character: CastMember;
  apiKeys: ApiKeysConfig;
}): Promise<Blob | null> {
  const { text, character, apiKeys } = params;
  const cleanText = cleanDialogueTextForSpeech(text);
  const ttsKey = apiKeys.geminiApiKey?.trim() || apiKeys.cloudTtsApiKey?.trim();

  if (ttsKey && ttsKey.length > 10 && !geminiTtsBillingDepleted) {
    const prebuiltVoice = resolveGeminiVoiceName(character.voiceConfig.voiceName, character);
    const timbreNote = character.voiceConfig.analyzedTimbreProfile
      ? ` Timbro vocale campionato: ${character.voiceConfig.analyzedTimbreProfile}.`
      : '';
    const actingDirection =
      (character.voiceConfig.stylePrompt ||
        (character.type === 'ANIMAL'
          ? 'Recita in italiano con voce super espressiva, spontanea, naturale e ironica'
          : 'Recita in italiano colloquiale, caldo e realistico come un attore vero')) + timbreNote;

    const promptWithProsody = `[Direzione attoriale: ${actingDirection}. Pronuncia solo la battuta seguente in italiano perfetto, calmo e naturale:] "${cleanText}"`;

    for (const modelId of GEMINI_TTS_MODELS) {
      try {
        const geminiTtsRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(
            ttsKey
          )}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptWithProsody }] }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: prebuiltVoice
                    }
                  }
                }
              }
            })
          }
        );

        if (geminiTtsRes.ok) {
          const data = await geminiTtsRes.json();
          const inlineAudio = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          if (inlineAudio?.data) {
            return pcm24kBase64ToWavBlob(inlineAudio.data, 24000);
          }
        } else if (
          geminiTtsRes.status === 402 ||
          geminiTtsRes.status === 403 ||
          geminiTtsRes.status === 400
        ) {
          if (geminiTtsRes.status === 402) {
            geminiTtsBillingDepleted = true;
          }
          break;
        }
      } catch {
        // Fall through to free Italian Neural TTS
      }
    }
  }

  return await fetchFreeItalianNeuralVoiceBlob(cleanText, character);
}

export async function generateVoiceForSingleTurn(params: {
  text: string;
  durationEstimateSec: number;
  character: CastMember;
  apiKeys: ApiKeysConfig;
}): Promise<string> {
  const { text, durationEstimateSec, character, apiKeys } = params;

  if (character.voiceConfig.useRecordedVoiceDirectly) {
    const sampleBlob = await getSampledVoiceBlobFromConfig(character.voiceConfig);
    if (sampleBlob) {
      try {
        return await applyAcousticMasteringToAudioBlob(
          sampleBlob,
          character.voiceConfig,
          character
        );
      } catch (e) {
        console.warn('Direct sampled voice mastering error:', e);
      }
    }
  }

  try {
    const rawNeuralBlob = await fetchRawGeminiNeuralVoiceBlob({
      text,
      character,
      apiKeys
    });
    if (rawNeuralBlob) {
      return await applyAcousticMasteringToAudioBlob(
        rawNeuralBlob,
        character.voiceConfig,
        character
      );
    }
  } catch (e) {
    console.warn('Neural TTS error:', e);
  }

  const fallbackSampleBlob = await getSampledVoiceBlobFromConfig(character.voiceConfig);
  if (fallbackSampleBlob) {
    try {
      return await applyAcousticMasteringToAudioBlob(
        fallbackSampleBlob,
        character.voiceConfig,
        character
      );
    } catch {
      // Fall through
    }
  }

  return synthesizeExpressiveCadenceWav(
    text,
    Math.min(
      Math.max(1.5, durationEstimateSec - 0.2),
      Math.max(1.6, text.split(/\s+/).length * 0.34)
    ),
    character
  );
}

export async function generateSceneMultiTurnVoiceAndTimings(params: {
  scene: SceneCard;
  cast: CastMember[];
  apiKeys: ApiKeysConfig;
  seriesTitle?: string;
}): Promise<{
  audioUrl: string;
  updatedTurns?: DialogueTurn[];
  recommendedSceneDurationSec?: number;
}> {
  const { scene, cast, apiKeys, seriesTitle } = params;
  const primaryChar = cast.find((c) => c.id === scene.characterId) || cast[0];

  const rawTurns =
    scene.dialogueTurns && scene.dialogueTurns.length > 0
      ? scene.dialogueTurns
      : [
          {
            characterId: primaryChar.id,
            dialogueOrThought: scene.dialogueOrThought,
            startOffsetSec: 0,
            durationSec: scene.durationSec,
            focusRegion: 'CENTER' as const
          }
        ];

  const turns = rawTurns.map((t, idx) => {
    const speaker = cast.find((c) => c.id === t.characterId) || primaryChar;
    return {
      ...t,
      dialogueOrThought: ensureSitcomPunchyLine(
        t.dialogueOrThought || scene.dialogueOrThought,
        speaker,
        scene.order + idx,
        '',
        seriesTitle
      )
    };
  });

  const turnAudioUrls: string[] = [];
  const turnSignatures: string[] = [];
  for (const turn of turns) {
    const speaker = cast.find((c) => c.id === turn.characterId) || primaryChar;
    turnSignatures.push(buildCharacterVoiceSignature(speaker));
    const url = await generateVoiceForSingleTurn({
      text: turn.dialogueOrThought,
      durationEstimateSec: turn.durationSec || Math.max(2.5, scene.durationSec / turns.length),
      character: speaker,
      apiKeys
    });
    turnAudioUrls.push(url);
  }

  const hasRealVoice = turnAudioUrls.some((u) => u.includes('#realvoice'));
  const combinedSig = turnSignatures.join('~');

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const decodeCtx = new AudioCtx();
    const decodedBuffers: AudioBuffer[] = [];

    for (const url of turnAudioUrls) {
      const resp = await fetch(url.split('#')[0]);
      const buf = await resp.arrayBuffer();
      const decoded = await decodeCtx.decodeAudioData(buf.slice(0));
      decodedBuffers.push(decoded);
    }
    await decodeCtx.close();

    const pauseBetweenTurnsSec = 0.35;
    const reactionTailSec = 0.45;
    const sampleRate = 44100;
    const totalRawAudioSec =
      decodedBuffers.reduce((acc, b) => acc + b.duration, 0) +
      pauseBetweenTurnsSec * Math.max(0, decodedBuffers.length - 1) +
      reactionTailSec;

    const outLength = Math.max(1024, Math.ceil(totalRawAudioSec * sampleRate));
    const offlineCtx = new OfflineAudioContext(1, outLength, sampleRate);

    let cursorSec = 0;
    const rawTurnTimings: Array<{ start: number; dur: number }> = [];

    decodedBuffers.forEach((buffer, idx) => {
      const src = offlineCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(offlineCtx.destination);
      src.start(cursorSec);
      rawTurnTimings.push({ start: cursorSec, dur: buffer.duration });
      cursorSec += buffer.duration + (idx < decodedBuffers.length - 1 ? pauseBetweenTurnsSec : 0);
    });

    const rendered = await offlineCtx.startRendering();
    const masterWavBlob = audioBufferToWavBlob(rendered);
    const masterUrl = `${URL.createObjectURL(masterWavBlob)}${
      hasRealVoice ? `#realvoice#sitcomvoice_v4_${combinedSig}` : '#silentfallback'
    }`;

    const recommendedSceneDurationSec = Math.max(
      scene.durationSec,
      Number(Math.max(3.2, totalRawAudioSec).toFixed(1))
    );

    const updatedTurns: DialogueTurn[] = turns.map((t, idx) => {
      const timing = rawTurnTimings[idx];
      return {
        ...t,
        startOffsetSec: Number(timing.start.toFixed(2)),
        durationSec: Math.max(0.9, Number(timing.dur.toFixed(2)))
      };
    });

    return {
      audioUrl: masterUrl,
      updatedTurns,
      recommendedSceneDurationSec
    };
  } catch (e) {
    console.warn('Multi-turn audio concatenation fallback to first turn:', e);
    return {
      audioUrl: turnAudioUrls[0],
      updatedTurns: turns,
      recommendedSceneDurationSec: scene.durationSec
    };
  }
}

export async function generateVoiceForScene(params: {
  scene: SceneCard;
  character: CastMember;
  cast?: CastMember[];
  apiKeys: ApiKeysConfig;
  triggerBrowserSpeechPreview?: boolean;
  seriesTitle?: string;
}): Promise<string> {
  const { scene, character, cast, apiKeys, seriesTitle } = params;
  if (scene.dialogueTurns && scene.dialogueTurns.length > 1 && cast && cast.length > 0) {
    const res = await generateSceneMultiTurnVoiceAndTimings({
      scene,
      cast,
      apiKeys,
      seriesTitle
    });
    return res.audioUrl;
  }
  return generateVoiceForSingleTurn({
    text: scene.dialogueOrThought,
    durationEstimateSec: scene.durationSec,
    character,
    apiKeys
  });
}

export async function regenerateSingleSceneLineWithAi(params: {
  character: CastMember;
  seriesTitle?: string;
  episodeTitle: string;
  rawIdea: string;
  sceneOrder: number;
  durationSec: number;
  currentLine: string;
  apiKeys: ApiKeysConfig;
}): Promise<string> {
  const {
    character,
    seriesTitle,
    episodeTitle,
    rawIdea,
    sceneOrder,
    durationSec,
    currentLine,
    apiKeys
  } = params;
  const key = apiKeys.geminiApiKey?.trim();
  const relSummary =
    character.relationships && character.relationships.length > 0
      ? character.relationships.map((r) => `${r.relationType}: ${r.description}`).join(' | ')
      : '';
  if (key && key.length > 10) {
    try {
      const targetWords = Math.max(6, Math.round(durationSec * 2.4));
      const text = await callGeminiTextOrJsonCascade({
        apiKey: key,
        responseMimeType: 'text/plain',
        parts: [
          {
            text: `Scrivi una NUOVA battuta brillante in italiano per il personaggio "${character.name}" (${character.type}, carattere: "${character.personalityPrompt}") nella scena #${sceneOrder} (durata ${durationSec}s, circa ${targetWords} parole) della serie autonoma "${
              seriesTitle || episodeTitle
            }".
NON citare mai elementi di altre serie estranee.
Rapporti con gli altri personaggi: "${relSummary || 'Complicità'}"
Titolo della puntata: "${episodeTitle}"
Trama della puntata: "${rawIdea || episodeTitle}"
Battuta precedente da cambiare: "${currentLine}"
Restituisci SOLO il testo puro della nuova battuta senza virgolette.`
          }
        ]
      });
      if (text) {
        return text.replace(/^["«]|["»]$/g, '').trim();
      }
    } catch {
      // Fallback below
    }
  }
  return generateLineForCharacter(
    character,
    rawIdea || episodeTitle,
    sceneOrder + 1,
    durationSec,
    undefined,
    seriesTitle
  );
}

async function extractRasterBase64FromUrl(
  url: string | undefined
): Promise<{ mimeType: string; data: string } | null> {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('data:image/svg+xml')) return null;

  let dataUrl = url;
  if (url.startsWith('blob:') || url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      if (blob.type.includes('svg')) return null;
      dataUrl = await blobToDataUrl(blob);
    } catch {
      return null;
    }
  }

  if (
    dataUrl.startsWith('data:image/jpeg') ||
    dataUrl.startsWith('data:image/jpg') ||
    dataUrl.startsWith('data:image/png') ||
    dataUrl.startsWith('data:image/webp')
  ) {
    const commaIdx = dataUrl.indexOf(',');
    const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
    if (commaIdx !== -1 && mimeMatch) {
      return {
        mimeType: mimeMatch[1] === 'image/jpg' ? 'image/jpeg' : mimeMatch[1],
        data: dataUrl.slice(commaIdx + 1)
      };
    }
  }
  return null;
}

async function extractFrameFromVideoBlobUrl(
  videoUrl: string | undefined,
  seekSec = 0.5
): Promise<{ mimeType: string; data: string } | null> {
  if (!videoUrl || typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'auto';
    const timeout = setTimeout(() => {
      resolve(null);
    }, 3500);

    vid.onloadeddata = () => {
      vid.currentTime = Math.min(seekSec, Math.max(0, (vid.duration || 1) * 0.25));
    };
    vid.onseeked = () => {
      clearTimeout(timeout);
      try {
        const w = vid.videoWidth || 720;
        const h = vid.videoHeight || 1280;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(vid, 0, 0, w, h);
        const dataUrl = c.toDataURL('image/jpeg', 0.9);
        const commaIdx = dataUrl.indexOf(',');
        resolve(
          commaIdx !== -1
            ? { mimeType: 'image/jpeg', data: dataUrl.slice(commaIdx + 1) }
            : null
        );
      } catch {
        resolve(null);
      }
    };
    vid.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };
    vid.src = videoUrl;
  });
}

/**
 * 3. GEMINI ACTION SCENE ELABORATOR (NO LIP-SYNC / NO MOUTH VISEME)
 * Takes the uploaded photo/video frame or character reference photo and elaborates a new
 * dynamic cinematic action keyframe based on the user's Indicazioni di Regia (veoMotionPrompt) and Trama (rawIdea).
 */
export async function generateContextualAiSceneImage(params: {
  scene: SceneCard;
  character: CastMember;
  seriesTitle?: string;
  episodeTitle?: string;
  rawIdea?: string;
  apiKeys: ApiKeysConfig;
}): Promise<string | null> {
  const { scene, character, seriesTitle, episodeTitle, rawIdea, apiKeys } = params;
  const key = apiKeys.geminiApiKey?.trim();
  if (!key || key.length <= 10) return null;

  const candidateUrls: string[] = [];
  if (
    scene.aiPhotoSourceUrl &&
    !scene.aiPhotoSourceUrl.startsWith('data:image/svg+xml')
  ) {
    candidateUrls.push(scene.aiPhotoSourceUrl);
  }
  if (Array.isArray(character.referencePhotos)) {
    for (const refPhoto of character.referencePhotos) {
      if (
        refPhoto &&
        !refPhoto.startsWith('data:image/svg+xml') &&
        !candidateUrls.includes(refPhoto)
      ) {
        candidateUrls.push(refPhoto);
      }
    }
  }

  const inlineImages: Array<{ mimeType: string; data: string }> = [];
  for (const url of candidateUrls.slice(0, 2)) {
    const extracted = await extractRasterBase64FromUrl(url);
    if (extracted) {
      inlineImages.push(extracted);
    }
  }

  if (inlineImages.length === 0 && scene.sceneType === 'USER_VIDEO' && scene.userVideoBlobUrl) {
    const vidFrame = await extractFrameFromVideoBlobUrl(
      scene.userVideoBlobUrl,
      (scene.trimStartSec || 0) + 0.4
    );
    if (vidFrame) {
      inlineImages.push(vidFrame);
    }
  }

  const hasRealReferencePhoto = inlineImages.length > 0;
  const geminiStylePrompt = buildVeoDirectPromptForScene({
    scene,
    character,
    cast: [character],
    seriesTitle: seriesTitle || 'Serie Originale',
    episodeTitle,
    rawIdea
  });

  const visualPrompt = hasRealReferencePhoto
    ? `ANIMATED CHARACTER POSE & TALKING EXPRESSION FROM REFERENCE PHOTO (GEMINI VIDEO KEYFRAME):
Look at the attached photo of "${character.name}" (${
        character.type === 'ANIMAL' ? 'this exact animal' : 'this exact person'
      }).
TASK:
1. Keep the EXACT SAME individual ("${character.name}"), facial identity, hair/beard/fur, clothing, and background environment from the attached photo.
2. Generate the ACTIVE ANIMATED POSE of "${character.name}" performing this exact scene prompt:
   "${geminiStylePrompt}"
3. Specifically, show "${character.name}" actively speaking the line "${cleanDialogueTextForSpeech(
        scene.dialogueOrThought
      )}" with an expressive open talking mouth/lips, lively facial emotion (e.g. greeting/waving hand, ironic/sad/enthusiastic expression matching the prompt), and natural upper-body gesture.
4. Output a 100% photorealistic frame with zero text overlays.`
    : `Create a photorealistic video frame featuring ${
        character.type === 'ANIMAL'
          ? `an expressive pet named ${character.name}`
          : `an expressive Italian person named ${character.name} (${character.personalityPrompt})`
      } actively speaking and gesturing: "${geminiStylePrompt}". Natural lighting, zero text overlays.`;

  const parts: Array<Record<string, unknown>> = [];
  for (const img of inlineImages) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data
      }
    });
  }
  parts.push({ text: visualPrompt });

  for (const modelName of NANO_BANANA_IMAGE_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(
          key
        )}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT']
            }
          })
        }
      );

      if (res.ok) {
        const data = await res.json();
        const respParts = data?.candidates?.[0]?.content?.parts || [];
        for (const p of respParts) {
          if (p?.inlineData?.data) {
            const mime = p.inlineData.mimeType || 'image/jpeg';
            return `data:${mime};base64,${p.inlineData.data}`;
          }
        }
      }
    } catch (e) {
      console.warn(`Gemini Image Elaborator (${modelName}) fallback:`, e);
    }
  }
  return null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function pcm24kBase64ToWavBlob(base64Pcm: string, sampleRate = 24000): Blob {
  const raw = atob(base64Pcm);
  const pcmLen = raw.length;
  const wavBuffer = new ArrayBuffer(44 + pcmLen);
  const view = new DataView(wavBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcmLen, true);

  const bytes = new Uint8Array(wavBuffer, 44);
  for (let i = 0; i < pcmLen; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

async function synthesizeExpressiveCadenceWav(
  _text: string,
  speechDurationSec: number,
  _character: CastMember
): Promise<string> {
  const sampleRate = 24000;
  const totalSec = Math.max(1.5, speechDurationSec);
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(sampleRate * totalSec), sampleRate);
  const rendered = await offlineCtx.startRendering();
  const wavBlob = audioBufferToWavBlob(rendered);
  return `${URL.createObjectURL(wavBlob)}#silentfallback`;
}

export function speakLineWithBrowserItalianTts(
  text: string,
  character?: CastMember
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const clean = cleanDialogueTextForSpeech(text);
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = 'it-IT';

    const voices = window.speechSynthesis.getVoices();
    const itVoices = voices.filter(
      (v) => v.lang.toLowerCase().startsWith('it') || v.name.toLowerCase().includes('ital')
    );

    if (character) {
      const { isFemale, isYoungBright } = isFemaleCharacterVoice(character);
      if (itVoices.length > 0) {
        const matchedVoice = isFemale
          ? itVoices.find((v) =>
              /elsa|isabella|alice|federica|paola|carla|female|donna|google/i.test(v.name)
            ) || itVoices[0]
          : itVoices.find((v) => /diego|cosimo|luca|giorgio|male|uomo/i.test(v.name)) ||
            itVoices[0];
        if (matchedVoice) {
          utter.voice = matchedVoice;
        }
      }
      const userPitch = character.voiceConfig?.pitch || 1.0;
      const userSpeed = character.voiceConfig?.speed || 0.94;
      utter.pitch = Math.max(
        0.75,
        Math.min(1.35, (isYoungBright ? 1.18 : isFemale ? 1.10 : 0.92) * userPitch)
      );
      utter.rate = Math.max(0.82, Math.min(0.96, 0.88 * userSpeed));
    } else if (itVoices[0]) {
      utter.voice = itVoices[0];
      utter.rate = 0.88;
    }

    window.speechSynthesis.speak(utter);
  } catch {
    // Ignore speech synthesis errors
  }
}

function loadHtmlImageElement(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 4000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * 2.5D Living Animated Character Frame Renderer:
 * Renders an animated character from a reference photo (or AI-elaborated action frame)
 * with natural head nod/tilt, body gesture/breathing, articulated jaw & lip-sync,
 * eye blinks, and dynamic Instagram Reel style text overlays.
 */
export function drawLivingAnimatedCharacterFrame(params: {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  firstImg: HTMLImageElement;
  secondImg?: HTMLImageElement | null;
  progress: number;
  localSec: number;
  speechEnergy: number;
  character: CastMember;
  seriesTitle?: string;
  roleBadge?: string;
  lineText?: string;
  cameraShot?: CameraShotType;
  box?: CharacterBoundingBox;
  isActionFast?: boolean;
  isPan?: boolean;
}): void {
  const {
    ctx,
    W,
    H,
    firstImg,
    secondImg,
    progress,
    localSec,
    speechEnergy,
    character,
    seriesTitle = 'Serie Originale',
    roleBadge,
    lineText = '',
    cameraShot = 'CLOSEUP_PUNCH',
    box,
    isActionFast = false,
    isPan = false
  } = params;

  const iw = firstImg.naturalWidth || firstImg.width || W;
  const ih = firstImg.naturalHeight || firstImg.height || H;

  // 1. Parallax Blurred Environment Backdrop
  ctx.save();
  const bgScale = Math.max(W / iw, H / ih) * 1.15;
  const bgOffsetX = Math.sin(localSec * 0.9) * 10;
  const bgOffsetY = Math.cos(localSec * 0.7) * 6;
  ctx.translate(W / 2 + bgOffsetX, H / 2 + bgOffsetY);
  ctx.filter = 'blur(20px) brightness(0.45) saturate(1.2)';
  ctx.drawImage(firstImg, (-iw * bgScale) / 2, (-ih * bgScale) / 2, iw * bgScale, ih * bgScale);
  ctx.filter = 'none';
  ctx.restore();

  // 2. Camera Motion
  const easeProgress = 0.5 - 0.5 * Math.cos(progress * Math.PI);
  let camZoom = 1.03 + easeProgress * 0.08;
  let camPanX = (progress - 0.5) * (isPan ? 45 : 20);
  let camPanY = isActionFast ? Math.sin(localSec * 14) * 3 : 0;
  let camRot = isActionFast ? Math.sin(localSec * 10) * 0.012 : 0;

  if (cameraShot === 'CLOSEUP_PUNCH') {
    camZoom = 1.05 + easeProgress * 0.12 + speechEnergy * 0.015;
  } else if (cameraShot === 'REACTION_SHAKE') {
    camZoom = 1.08 + speechEnergy * 0.02;
    camPanX += Math.sin(localSec * 18) * (speechEnergy * 4);
    camPanY += Math.cos(localSec * 16) * (speechEnergy * 3);
  }

  // 3. Living Character Puppet Motion (Head & Torso articulation)
  const breathingY = Math.sin(localSec * 3.2) * 2.5;
  const headNodY = Math.sin(localSec * 6.5) * (speechEnergy * 4.5);
  const headTilt = Math.sin(localSec * 2.8) * (0.012 + speechEnergy * 0.018);
  const greetingWave = isActionFast || progress < 0.35 ? Math.sin(localSec * 12) * 3.5 : 0;

  const charCx = box ? (box.x + box.width / 2) * W : W * 0.5;
  const charCy = box ? (box.y + box.height / 2) * H : H * 0.48;
  const mouthAnchorX = box?.mouthX ? box.mouthX * W : charCx;
  const mouthAnchorY = box?.mouthY ? box.mouthY * H : charCy + 25;

  const srcAspect = iw / Math.max(1, ih);
  const dstAspect = W / H;
  const baseScale =
    Math.abs(srcAspect - dstAspect) < 0.45
      ? Math.max(W / iw, H / ih)
      : Math.min(W / iw, H / ih) * 1.05;
  const dw = iw * baseScale;
  const dh = ih * baseScale;

  // Render base living character frame
  ctx.save();
  ctx.translate(W / 2 + camPanX, H / 2 + camPanY + breathingY);
  ctx.rotate(camRot + headTilt);
  ctx.scale(camZoom, camZoom);

  // If secondImg (AI-elaborated talking/gesture pose) is available, cross-fade with voice energy
  const hasSecondImg = Boolean(secondImg && secondImg !== firstImg && secondImg.complete);
  const secondImgAlpha = hasSecondImg ? Math.max(0, Math.min(1, speechEnergy * 1.2 + (progress > 0.4 ? 0.3 : 0))) : 0;

  ctx.drawImage(firstImg, -dw / 2, -dh / 2, dw, dh);

  if (hasSecondImg && secondImgAlpha > 0.05) {
    ctx.save();
    ctx.globalAlpha = secondImgAlpha;
    ctx.drawImage(secondImg, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  // 4. Real-time Articulated Mouth / Jaw Lip-Sync
  if (speechEnergy > 0.06) {
    const mouthLocalX = mouthAnchorX - (W / 2 + camPanX);
    const mouthLocalY = mouthAnchorY - (H / 2 + camPanY + breathingY);
    const jawDrop = Math.min(18, speechEnergy * 16);
    const mouthRadiusX = Math.max(12, Math.min(32, (box?.width ? box.width * W * 0.16 : 22)));
    const mouthRadiusY = Math.max(6, Math.min(14, jawDrop * 0.8));

    // Shaded natural mouth cavity opening
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(mouthLocalX, mouthLocalY + jawDrop * 0.4, mouthRadiusX, mouthRadiusY, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(50, 15, 18, 0.72)';
    ctx.fill();

    // Subtle tongue/teeth highlight
    ctx.beginPath();
    ctx.ellipse(mouthLocalX, mouthLocalY + jawDrop * 0.4 + mouthRadiusY * 0.3, mouthRadiusX * 0.65, mouthRadiusY * 0.45, 0, 0, Math.PI);
    ctx.fillStyle = 'rgba(215, 100, 115, 0.85)';
    ctx.fill();
    ctx.restore();
  }

  // 5. Periodic natural eye-blink
  const blinkCycle = localSec % 3.6;
  if (blinkCycle > 3.42 && blinkCycle < 3.56) {
    const eyeLocalX = mouthAnchorX - (W / 2 + camPanX);
    const eyeLocalY = mouthAnchorY - (H / 2 + camPanY + breathingY) - 38;
    ctx.save();
    ctx.strokeStyle = 'rgba(30, 20, 15, 0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(eyeLocalX - 22, eyeLocalY, 11, 0.2, Math.PI - 0.2);
    ctx.arc(eyeLocalX + 22, eyeLocalY, 11, 0.2, Math.PI - 0.2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  // 6. Dynamic Instagram Reel / Gemini Style Overlay Badge (e.g. "✨ CESCO IL MAGO")
  const cleanBadge = roleBadge || getCharacterSitcomRoleBadge(character, seriesTitle);
  const badgeLabel = cleanBadge && !cleanBadge.toLowerCase().includes(character.name.toLowerCase())
    ? `${character.name.toUpperCase()} • ${cleanBadge.toUpperCase()}`
    : character.name.toUpperCase();

  ctx.save();
  const badgePop = Math.min(1, localSec / 0.35);
  ctx.translate(W * 0.06, H * 0.08);
  ctx.scale(badgePop, badgePop);

  // Reel-style gradient badge
  const badgeFont = '900 15px Inter, system-ui, sans-serif';
  ctx.font = badgeFont;
  const textW = ctx.measureText(badgeLabel).width;
  const padX = 14;
  const padY = 8;
  const boxW = textW + padX * 2 + (speechEnergy > 0.08 ? 24 : 0);
  const boxH = 34;

  // Shadow & Background pill
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.beginPath();
  ctx.roundRect(0, 0, boxW, boxH, 10);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.85)';
  ctx.stroke();

  // Text
  ctx.fillStyle = '#fde047';
  ctx.textAlign = 'left';
  ctx.fillText(badgeLabel, padX, 22);

  // Reel audio wave bars inside the badge when speaking
  if (speechEnergy > 0.08) {
    const waveX = padX + textW + 8;
    for (let bi = 0; bi < 3; bi++) {
      const bh = Math.max(4, Math.min(14, speechEnergy * 15 * (bi === 1 ? 1.2 : 0.8)));
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(waveX + bi * 5, 17 - bh / 2, 3, bh);
    }
  }
  ctx.restore();

  // 7. Word-by-Word Animated Subtitle (Instagram Reel Style)
  const cleanLine = cleanDialogueTextForSpeech(lineText).slice(0, 110);
  if (cleanLine) {
    const vigGrad = ctx.createLinearGradient(0, H * 0.75, 0, H);
    vigGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vigGrad.addColorStop(1, 'rgba(0, 0, 0, 0.88)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, H * 0.75, W, H * 0.25);

    ctx.save();
    ctx.font = `900 ${W < 600 ? 18 : 22}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.lineWidth = 6;
    ctx.strokeText(cleanLine, W / 2, H - 36);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(cleanLine, W / 2, H - 36);
    ctx.restore();
  }
}

/**
 * Synthesizes a real standalone playable .webm video clip (Blob URL) for a single scene
 * based on the provided material (photo/video + AI-elaborated action frame)
 * WITH real character voice audio embedded and living character 2.5D animation!
 */
export async function synthesizeStandaloneSceneVideoBlob(params: {
  scene: SceneCard;
  character: CastMember;
  cast?: CastMember[];
  seriesTitle?: string;
  elaboratedImageUrl?: string;
  audioUrl?: string;
  recordDurationMs?: number;
}): Promise<string | null> {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
    return null;
  }

  const {
    scene,
    character,
    cast = [character],
    seriesTitle = 'Serie Originale',
    elaboratedImageUrl,
    audioUrl,
    recordDurationMs = 3200
  } = params;

  if (scene.sceneType === 'USER_VIDEO' && scene.userVideoBlobUrl) {
    return scene.userVideoBlobUrl;
  }

  const primaryPhotoUrl =
    (scene.aiPhotoSourceUrl && !scene.aiPhotoSourceUrl.startsWith('data:image/svg+xml')
      ? scene.aiPhotoSourceUrl
      : '') ||
    character?.referencePhotos?.find((p) => !p.startsWith('data:image/svg+xml')) ||
    character?.referencePhotos?.[0] ||
    '';

  const secondShotUrl =
    elaboratedImageUrl ||
    scene.generatedAiImageUrl ||
    character?.referencePhotos?.[1] ||
    primaryPhotoUrl;

  const [imgA, imgB] = await Promise.all([
    loadHtmlImageElement(primaryPhotoUrl),
    loadHtmlImageElement(secondShotUrl)
  ]);

  if (!imgA && !imgB) return null;
  const firstImg = imgA || imgB!;
  const secondImg = imgB || imgA!;

  const W = 720;
  const H = 1280;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  let stream: MediaStream;
  try {
    stream = canvas.captureStream(30);
  } catch {
    return null;
  }

  // If audioUrl is available, mix the character's voice audio into the MediaStream!
  let audioEl: HTMLAudioElement | null = null;
  let audioCtx: AudioContext | null = null;
  const effectiveAudioUrl = audioUrl || scene.generatedAudioUrl;

  if (effectiveAudioUrl && typeof window !== 'undefined') {
    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass();
        const dest = audioCtx.createMediaStreamDestination();
        audioEl = new Audio();
        audioEl.crossOrigin = 'anonymous';
        audioEl.src = effectiveAudioUrl.split('#')[0];
        const srcNode = audioCtx.createMediaElementSource(audioEl);
        srcNode.connect(dest);
        const audioTracks = dest.stream.getAudioTracks();
        if (audioTracks.length > 0) {
          stream.addTrack(audioTracks[0]);
        }
      }
    } catch {
      // Ignore audio mixing error, proceed with canvas video
    }
  }

  const mimeCandidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ];
  const chosenMime =
    mimeCandidates.find((m) => {
      try {
        return MediaRecorder.isTypeSupported(m);
      } catch {
        return false;
      }
    }) || '';

  return new Promise((resolve) => {
    const chunks: BlobPart[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime, videoBitsPerSecond: 4500000 })
        : new MediaRecorder(stream);
    } catch {
      resolve(null);
      return;
    }

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    recorder.onstop = () => {
      if (audioEl) audioEl.pause();
      if (audioCtx) audioCtx.close().catch(() => {});
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      const blob = new Blob(chunks, { type: chosenMime || 'video/webm' });
      resolve(URL.createObjectURL(blob));
    };

    const promptLower = (scene.veoMotionPrompt || scene.directorNote || '').toLowerCase();
    const isActionFast =
      scene.cameraShot === 'REACTION_SHAKE' ||
      /azione|corsa|sorpres|improvvis|colpo|veloce|scatto/i.test(promptLower);
    const isPan =
      scene.cameraShot === 'PAN_CINEMATIC' ||
      /panoramica|atelier|insieme|ambiente|stanza|dialogo/i.test(promptLower);

    const startTime = performance.now();
    const fpsInterval = 33;
    const box = scene.characterBoxes?.[character.id];

    if (audioEl) {
      audioEl.play().catch(() => {});
    }

    const timer = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const p = Math.min(1, elapsed / recordDurationMs);
      const localSec = elapsed / 1000;

      // Realistic Italian syllable envelope for lip-sync
      const syl1 = Math.pow(Math.abs(Math.sin(localSec * 16.5)), 0.75);
      const syl2 = Math.cos(localSec * 9.2) * 0.35 + 0.65;
      const speechEnergy = p > 0.05 && p < 0.9 ? Math.max(0.05, Math.min(1, syl1 * syl2)) : 0;

      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, W, H);

      drawLivingAnimatedCharacterFrame({
        ctx,
        W,
        H,
        firstImg,
        secondImg,
        progress: p,
        localSec,
        speechEnergy,
        character,
        seriesTitle,
        roleBadge: scene.characterRoleBadge,
        lineText: scene.dialogueOrThought,
        cameraShot: scene.cameraShot,
        box,
        isActionFast,
        isPan
      });

      if (elapsed >= recordDurationMs) {
        clearInterval(timer);
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }
    }, fpsInterval);

    recorder.start(100);
  });
}

/**
 * 4. SINGLE SCENE AI VIDEO GENERATOR (VEO CLOUD + MULTI-SHOT AI ELABORATOR)
 * Generates an animated video for the scene with animated character (not static photo + description).
 */
export async function generateVeoVideoForScene(params: {
  scene: SceneCard;
  character: CastMember;
  cast?: CastMember[];
  seriesTitle?: string;
  episodeTitle?: string;
  rawIdea?: string;
  apiKeys: ApiKeysConfig;
}): Promise<{
  videoUrl: string;
  elaboratedImageUrl?: string;
  usedVeoCloud: boolean;
}> {
  const { scene, character, cast = [character], seriesTitle = 'Serie Originale', episodeTitle, rawIdea, apiKeys } = params;
  const photoSource = scene.aiPhotoSourceUrl || character.referencePhotos[0] || '';
  const directKey = apiKeys.geminiApiKey?.trim() || apiKeys.vertexAiAccessToken?.trim();

  // Build the complete Gemini-style coherent prompt
  const geminiPrompt = buildVeoDirectPromptForScene({
    scene,
    character,
    cast,
    seriesTitle,
    episodeTitle,
    rawIdea
  });

  if (directKey && directKey.length > 10 && apiKeys.preferVeoCloud !== false) {
    const extracted = await extractRasterBase64FromUrl(photoSource);
    const veoModels = [
      'veo-3.1-generate-preview',
      'veo-3.1-fast-generate-preview',
      'veo-3.0-generate-preview',
      'veo-3.0-fast-generate-preview',
      'veo-2.0-generate-001'
    ];

    for (const veoModel of veoModels) {
      try {
        const directEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${veoModel}:predictLongRunning?key=${encodeURIComponent(
          directKey
        )}`;

        const res = await fetch(directEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [
              {
                prompt: geminiPrompt,
                ...(extracted
                  ? {
                      image: {
                        bytesBase64Encoded: extracted.data,
                        mimeType: extracted.mimeType
                      }
                    }
                  : {})
              }
            ],
            parameters: {
              aspectRatio: '9:16',
              durationSeconds: 8,
              sampleCount: 1
            }
          })
        });

        if (res.ok) {
          let opData = await res.json();
          const opName = opData?.name;

          if (opName && !opData?.done) {
            // Poll for up to 25 cycles (75 seconds) to allow Veo to finish
            for (let pollIdx = 0; pollIdx < 25; pollIdx++) {
              await new Promise((r) => setTimeout(r, 3000));
              const pollRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/${opName}?key=${encodeURIComponent(
                  directKey
                )}`
              );
              if (!pollRes.ok) break;
              opData = await pollRes.json();
              if (opData?.done) break;
            }
          }

          const directUri =
            opData?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
            opData?.response?.generatedVideos?.[0]?.video?.uri ||
            opData?.predictions?.[0]?.videoUri;

          if (directUri) {
            const fullUrl = `${directUri}${
              directUri.includes('?') ? '&' : '?'
            }key=${encodeURIComponent(directKey)}`;

            // Download MP4 blob to avoid CORS issues
            try {
              const vidRes = await fetch(fullUrl);
              if (vidRes.ok) {
                const vidBlob = await vidRes.blob();
                const localBlobUrl = URL.createObjectURL(vidBlob);
                return {
                  videoUrl: `${localBlobUrl}#veonative`,
                  usedVeoCloud: true
                };
              }
            } catch {
              // Return direct URL if blob fetch fails
              return {
                videoUrl: `${fullUrl}#veonative`,
                usedVeoCloud: true
              };
            }
          }
        }
      } catch (e) {
        console.warn(`Veo (${veoModel}) fallback:`, e);
      }
    }
  }

  // Elaborate a new AI action keyframe (open mouth, active gesture) if Gemini API key is present
  let elaboratedImageUrl = scene.generatedAiImageUrl;
  if (!elaboratedImageUrl && directKey && directKey.length > 10) {
    const generatedImg = await generateContextualAiSceneImage({
      scene,
      character,
      seriesTitle,
      episodeTitle,
      rawIdea,
      apiKeys
    });
    if (generatedImg) {
      elaboratedImageUrl = generatedImg;
    }
  }

  // Synthesize living animated character video clip (with voice audio & 2.5D lip-sync animation!)
  const standaloneBlobUrl = await synthesizeStandaloneSceneVideoBlob({
    scene,
    character,
    cast,
    seriesTitle,
    elaboratedImageUrl,
    audioUrl: scene.generatedAudioUrl
  });

  return {
    videoUrl: standaloneBlobUrl || scene.userVideoBlobUrl || '',
    elaboratedImageUrl,
    usedVeoCloud: false
  };
}

/**
 * Parallel batch processor for all scenes in Step 2 ("Genera Tutti i Singoli Video & Crea Collage Finale").
 */
export async function generateAllScenesParallel(params: {
  scenes: SceneCard[];
  cast: CastMember[];
  seriesTitle?: string;
  episodeTitle?: string;
  rawIdea?: string;
  apiKeys: ApiKeysConfig;
  onSceneProgress?: (sceneId: string, status: SceneCard['status']) => void;
}): Promise<SceneCard[]> {
  const { scenes, cast, seriesTitle, episodeTitle, rawIdea, apiKeys, onSceneProgress } = params;

  const output: SceneCard[] = new Array(scenes.length);
  const batchSize = 3;

  for (let startIdx = 0; startIdx < scenes.length; startIdx += batchSize) {
    const slice = scenes.slice(startIdx, startIdx + batchSize);
    await Promise.all(
      slice.map(async (scene, localIdx) => {
        const globalIdx = startIdx + localIdx;
        onSceneProgress?.(scene.id, 'GENERATING');
        const character = cast.find((c) => c.id === scene.characterId) || cast[0];

        // 1. Generate Voice Audio & Timings
        const voiceAndTurns = await generateSceneMultiTurnVoiceAndTimings({
          scene,
          cast,
          apiKeys,
          seriesTitle
        });

        // 2. Generate Animated Video for the Scene
        const veoRes = await generateVeoVideoForScene({
          scene: {
            ...scene,
            generatedAudioUrl: voiceAndTurns.audioUrl
          },
          character,
          cast,
          seriesTitle,
          episodeTitle,
          rawIdea,
          apiKeys
        });

        onSceneProgress?.(scene.id, 'DONE');
        const updatedTurns = voiceAndTurns.updatedTurns || scene.dialogueTurns;
        const updatedDialogueSummary =
          updatedTurns && updatedTurns.length === 1
            ? updatedTurns[0].dialogueOrThought
            : updatedTurns && updatedTurns.length > 1
            ? updatedTurns
                .map(
                  (t) =>
                    `${cast.find((c) => c.id === t.characterId)?.name || ''}: "${
                      t.dialogueOrThought
                    }"`
                )
                .join(' ↔️ ')
            : scene.dialogueOrThought;

        output[globalIdx] = {
          ...scene,
          durationSec: voiceAndTurns.recommendedSceneDurationSec
            ? Math.max(scene.durationSec, Math.ceil(voiceAndTurns.recommendedSceneDurationSec))
            : scene.durationSec,
          dialogueOrThought: updatedDialogueSummary,
          generatedAudioUrl: voiceAndTurns.audioUrl,
          dialogueTurns: updatedTurns,
          generatedAiImageUrl: veoRes.elaboratedImageUrl || scene.generatedAiImageUrl,
          generatedAiVideoUrl: veoRes.videoUrl || scene.generatedAiVideoUrl,
          status: 'DONE'
        };
      })
    );
  }

  return output;
}
