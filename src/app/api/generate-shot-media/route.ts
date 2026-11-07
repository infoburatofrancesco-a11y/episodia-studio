import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Edge Runtime su Vercel consente fino a 30s di streaming/risposta anche su piano Hobby,
// permettendo a nano-banana-pro-preview (14s) di completare sempre senza timeout 504!
export const runtime = 'edge';
export const maxDuration = 60;

interface GenerateShotMediaBody {
  step?: 'base' | 'variant';
  baseFrameBase64?: string;
  variantType?:
    | 'speaking'
    | 'reaction'
    | 'speaking_open'
    | 'speaking_gesture'
    | 'group_reaction';
  visualPromptEn: string;
  cameraAngle?: string;
  dialogueIta?: string;
  speakerName?: string;
  speakerDescriptor?: string;
  speakerCategory?: 'human' | 'animal';
  characterNames?: string[];
  aspectRatio?: '9:16' | '16:9';
  referenceImagesBase64?: string[];
  shotNumber?: number;
}

function parseDataUrl(
  dataUrl: string
): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return null;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryStr = atob(base64);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...Array.from(sub));
  }
  return btoa(binary);
}

function writeAsciiString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// Converte audio PCM 16-bit 24kHz mono in un file WAV standard Base64 (compatibile Edge Runtime)
function pcm24kMonoToWavBase64(pcmBase64: string, sampleRate = 24000): string {
  const pcmBytes = base64ToUint8Array(pcmBase64);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBytes.byteLength;

  const wavBytes = new Uint8Array(44 + dataSize);
  const view = new DataView(wavBytes.buffer);

  writeAsciiString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiString(view, 8, 'WAVE');
  writeAsciiString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAsciiString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  wavBytes.set(pcmBytes, 44);
  return `data:audio/wav;base64,${uint8ArrayToBase64(wavBytes)}`;
}

const MALE_VOICES = ['Orus', 'Puck', 'Fenrir', 'Charon'];
const FEMALE_VOICES = ['Aoede', 'Kore', 'Leda', 'Zephyr'];

function isFemaleSpeaker(speakerName?: string, descriptor?: string): boolean {
  const name = (speakerName || '').trim().toLowerCase();
  const desc = (descriptor || '').trim().toLowerCase();

  if (
    /^(cristina|zora|uma|giulia|maria|anna|sara|laura|chiara|elena|sofia|martina|francesca|valentina|silvia|alice|federica|elisa)$/i.test(
      name
    )
  ) {
    return true;
  }
  if (
    /^(cesco|francesco|marco|luca|matteo|andrea|alessandro|davide|lorenzo|simone|giovanni|roberto|paolo|stefano)$/i.test(
      name
    )
  ) {
    return false;
  }
  if (
    /\b(female|woman|girl|donna|ragazza|signora|femmina|lei|she|her|wife|moglie)\b/i.test(
      desc
    )
  ) {
    return true;
  }
  if (
    /\b(male|man|boy|uomo|ragazzo|signore|maschio|lui|he|his|husband|marito)\b/i.test(
      desc
    )
  ) {
    return false;
  }
  return name.endsWith('a') && !name.endsWith('ia');
}

function pickVoiceForSpeaker(
  speakerName?: string,
  speakerDescriptor?: string
): string {
  const female = isFemaleSpeaker(speakerName, speakerDescriptor);
  const pool = female ? FEMALE_VOICES : MALE_VOICES;
  if (!speakerName) return pool[0];
  let hash = 0;
  for (let i = 0; i < speakerName.length; i++) {
    hash = (hash * 31 + speakerName.charCodeAt(i)) % 1000;
  }
  return pool[hash % pool.length];
}

async function generateSingleNanoBananaFrame(
  ai: GoogleGenAI,
  refParts: Array<{ inlineData: { mimeType: string; data: string } }>,
  promptText: string,
  preferFastInPlaceEdit = false
): Promise<string | null> {
  // Per il Frame 0 Master usiamo Nano Banana Pro (massima fedeltà 1:1 a volti, vestiti, parrucche, cappelli e animali dalle foto).
  // Per le varianti in-place veloci usiamo gemini-2.5-flash-image (6s) + nano-banana-2.1.
  const nanoBananaModels = preferFastInPlaceEdit
    ? [
        'gemini-2.5-flash-image',
        'gemini-nano-banana-2.1',
        'gemini-3.1-flash-image',
        'nano-banana-pro-preview',
      ]
    : [
        'nano-banana-pro-preview',
        'gemini-3-pro-image',
        'gemini-nano-banana-2.1',
        'gemini-2.5-flash-image',
      ];

  for (const modelName of nanoBananaModels) {
    try {
      const res = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [...refParts, { text: promptText }],
          },
        ],
        config: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      });

      const parts = res.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
        if (
          p.inlineData?.data &&
          p.inlineData?.mimeType?.startsWith('image/')
        ) {
          return `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
        }
      }
    } catch (err) {
      console.warn(`Fallback Nano Banana model (${modelName}):`, err);
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'inserisci_qui_la_tua_chiave_gemini') {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY mancante in .env.local o su Vercel.' },
        { status: 500 }
      );
    }

    const body = (await req.json()) as GenerateShotMediaBody;
    const {
      step = 'base',
      baseFrameBase64,
      variantType = 'speaking_open',
      visualPromptEn,
      cameraAngle,
      dialogueIta,
      speakerName,
      speakerDescriptor,
      characterNames = [],
      aspectRatio = '9:16',
      referenceImagesBase64 = [],
    } = body;

    const ai = new GoogleGenAI({ apiKey });

    const orientationLabel =
      aspectRatio === '9:16'
        ? 'vertical 9:16 portrait smartphone social format'
        : 'horizontal 16:9 widescreen cinematic format';

    const targetSpeaker =
      speakerName || characterNames[0] || 'the main character';

    // PASSO VARIANTE IN-PLACE: mantiene sfondo, vestiti e volti IDENTICI al 100% al Frame 0,
    // animando bocca, espressioni e interazione tra gli attori!
    if (step === 'variant' && baseFrameBase64) {
      const parsedBase = parseDataUrl(baseFrameBase64);
      if (!parsedBase) {
        return NextResponse.json({ frameImageBase64: null });
      }
      let variantPrompt = '';
      if (variantType === 'speaking_open' || variantType === 'speaking') {
        variantPrompt = `IN-PLACE PHOTO EDIT (${orientationLabel}): Keep 100% of the exact same background, room, camera angle, lighting, clothing, hats/accessories, and exact facial identities from this image unchanged. ONLY animate ${targetSpeaker} speaking expressively: ${targetSpeaker}'s mouth is naturally open pronouncing a vowel ('Ah'/'Oh') with an active conversational hand gesture, while the other characters/animals in the shot look at ${targetSpeaker} and react with lively expressions. No text overlays.`;
      } else if (variantType === 'speaking_gesture') {
        variantPrompt = `IN-PLACE PHOTO EDIT (${orientationLabel}): Keep 100% of the exact same background, room, camera angle, lighting, clothing, hats/accessories, and exact facial identities from this image unchanged. ONLY animate ${targetSpeaker} mid-sentence: ${targetSpeaker}'s mouth is half-open speaking with a warm expressive smile, slight natural head tilt, and shifted hand position, while the other characters/animals in the shot interact naturally. No text overlays.`;
      } else {
        variantPrompt = `IN-PLACE PHOTO EDIT (${orientationLabel}): Keep 100% of the exact same background, room, camera angle, lighting, clothing, hats/accessories, and exact facial identities from this image unchanged. Animate a joyful group reaction moment: all characters in the shot are smiling/laughing warmly and interacting together (clapping, petting the dog/pet if present, or sharing a comedic reaction), with mouths closed or smiling naturally. No text overlays.`;
      }

      const variantFrame = await generateSingleNanoBananaFrame(
        ai,
        [
          {
            inlineData: {
              mimeType: parsedBase.mimeType,
              data: parsedBase.data,
            },
          },
        ],
        variantPrompt,
        true
      );

      return NextResponse.json({
        frameImageBase64: variantFrame,
        modelUsed: 'gemini-2.5-flash-image',
      });
    }

    // PASSO BASE: invia fino a 4 foto reali di riferimento del Cast a Nano Banana Pro
    // per preservare 1:1 i soggetti, i vestiti, gli accessori e gli animali domestici!
    const refParts: Array<{ inlineData: { mimeType: string; data: string } }> =
      [];
    for (const refImg of referenceImagesBase64.slice(0, 4)) {
      const parsed = parseDataUrl(refImg);
      if (parsed) {
        refParts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data,
          },
        });
      }
    }

    const castNamesList =
      characterNames.length > 0
        ? `Subjects from the attached reference photos to include together interacting in this shot: ${characterNames.join(', ')}. Active speaker: ${targetSpeaker}.`
        : `Subject from the attached reference photo: ${targetSpeaker}.`;

    const masterPrompt = `Using the exact subjects from these reference photos, create a realistic live-action photograph (${orientationLabel}) where the actors interact naturally with each other.
- STRICT 1:1 IDENTITY & APPEARANCE LOCK: Preserve 100% of the exact real faces, facial features, hair/wigs, hats, glasses, clothing, and pets/animals directly from the attached reference photos. Do NOT replace them with generic models or alter their faces.
- ${castNamesList}
- Camera & Scene Action: ${cameraAngle || 'Medium shot'}. ${visualPromptEn}.
- Keyframe 0 Pose: The actors are together in the scene interacting naturally; ${targetSpeaker} has a natural closed-mouth or gentle smile expression just before speaking. Photorealistic iPhone 16 Pro video frame, natural lighting, no text overlays, no watermarks.`;

    const [frame1, audioWavBase64] = await Promise.all([
      generateSingleNanoBananaFrame(ai, refParts, masterPrompt, false),
      (async (): Promise<string | null> => {
        if (!dialogueIta || !dialogueIta.trim()) return null;
        const cleanDialogue = dialogueIta
          .trim()
          .replace(/^["“«]+|["”»]+$/g, '')
          .trim();
        if (!cleanDialogue) return null;

        // Controlliamo se il dialogo contiene un botta-e-risposta tra più personaggi (es. "Cristina: ... \n Cesco: ...")
        const speakerLines = cleanDialogue
          .split(/\n+/)
          .map((l) => l.trim())
          .filter(Boolean);
        const multiSpeakerMatches = speakerLines
          .map((l) => l.match(/^([A-Za-zÀ-ÿ0-9_ ]{2,20}):\s*(.+)$/))
          .filter((m): m is RegExpMatchArray => Boolean(m));

        const uniqueSpeakers = Array.from(
          new Set(multiSpeakerMatches.map((m) => m[1].trim()))
        );

        const ttsModels = [
          'gemini-2.5-pro-preview-tts',
          'gemini-2.5-flash-preview-tts',
          'gemini-3.8-flash-tts',
        ];

        for (const ttsModel of ttsModels) {
          try {
            const speechConfig =
              uniqueSpeakers.length >= 2
                ? {
                    languageCode: 'it-IT',
                    multiSpeakerVoiceConfig: {
                      speakerVoiceConfigs: uniqueSpeakers
                        .slice(0, 2)
                        .map((spName) => ({
                          speaker: spName,
                          voiceConfig: {
                            prebuiltVoiceConfig: {
                              voiceName: pickVoiceForSpeaker(spName),
                            },
                          },
                        })),
                    },
                  }
                : {
                    languageCode: 'it-IT',
                    voiceConfig: {
                      prebuiltVoiceConfig: {
                        voiceName: pickVoiceForSpeaker(
                          speakerName,
                          speakerDescriptor
                        ),
                      },
                    },
                  };

            const ttsRes = await ai.models.generateContent({
              model: ttsModel,
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: cleanDialogue,
                    },
                  ],
                },
              ],
              config: {
                responseModalities: ['AUDIO'],
                speechConfig,
              },
            });

            const audioPart = ttsRes.candidates?.[0]?.content?.parts?.find(
              (p) => p.inlineData?.data
            );
            if (audioPart?.inlineData?.data) {
              const mime =
                audioPart.inlineData.mimeType || 'audio/L16;rate=24000';
              if (mime.includes('wav')) {
                return `data:audio/wav;base64,${audioPart.inlineData.data}`;
              }
              return pcm24kMonoToWavBase64(audioPart.inlineData.data, 24000);
            }
          } catch (ttsErr) {
            console.warn(`Fallback modello TTS (${ttsModel}):`, ttsErr);
          }
        }
        return null;
      })(),
    ]);

    const framesBase64 = frame1
      ? [frame1]
      : referenceImagesBase64.slice(0, 1);

    return NextResponse.json({
      frameImageBase64: framesBase64[0] || null,
      framesBase64,
      audioWavBase64,
      modelUsed: 'nano-banana-pro-preview',
    });
  } catch (error: unknown) {
    console.error('Errore in /api/generate-shot-media:', error);
    const msg =
      error instanceof Error
        ? error.message
        : 'Errore imprevisto durante la generazione Nano Banana dello shot.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
