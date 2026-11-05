import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Estende il timeout delle Serverless Functions su Vercel fino a 60 secondi
export const maxDuration = 60;

interface GenerateShotMediaBody {
  step?: 'base' | 'variant';
  baseFrameBase64?: string;
  variantType?: 'speaking' | 'reaction' | 'speaking_open' | 'speaking_gesture';
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

// Converte audio PCM 16-bit 24kHz mono (restituito da Gemini TTS) in un file WAV standard Base64
function pcm24kMonoToWavBase64(pcmBase64: string, sampleRate = 24000): string {
  const pcmBuffer = Buffer.from(pcmBase64, 'base64');
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const wavHeader = Buffer.alloc(44);

  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + dataSize, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(dataSize, 40);

  const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
  return `data:audio/wav;base64,${wavBuffer.toString('base64')}`;
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
  return name.endsWith('a') && !name.endsWith('ia') ? true : false;
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
  promptText: string
): Promise<string | null> {
  // Priorità assoluta ai modelli Nano Banana dedicati alla fedeltà fotografica 1:1 del volto
  const nanoBananaModels = [
    'gemini-nano-banana-2.1',
    'nano-banana-pro-preview',
    'gemini-3-pro-image',
    'gemini-3.1-flash-image',
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

    const targetSpeaker = speakerName || characterNames[0] || 'the main character';

    // PASSO VARIANTE IN-PLACE: mantiene sfondo, vestiti e volto IDENTICI al 100% al Frame 0,
    // animando SOLO bocca, espressione e gesto delle mani per il lip-sync reale!
    if (step === 'variant' && baseFrameBase64) {
      const parsedBase = parseDataUrl(baseFrameBase64);
      if (!parsedBase) {
        return NextResponse.json({ frameImageBase64: null });
      }
      const variantPrompt =
        variantType === 'speaking_open' || variantType === 'speaking'
          ? `IN-PLACE PHOTO EDIT (${orientationLabel}): Keep 100% of the exact same background, room, camera angle, lighting, clothing, and exact facial identity from this image unchanged. ONLY animate ${targetSpeaker} speaking a vowel syllable: ${targetSpeaker}'s mouth is naturally open mid-speech pronouncing 'Ah', lively eyes, and an active conversational hand gesture. Do not change anyone's face or background. No text overlays.`
          : `IN-PLACE PHOTO EDIT (${orientationLabel}): Keep 100% of the exact same background, room, camera angle, lighting, clothing, and exact facial identity from this image unchanged. ONLY animate ${targetSpeaker} mid-sentence: ${targetSpeaker}'s mouth is half-open speaking a word with a warm expressive smile, slight natural head tilt, and shifted hand gesture. Do not change anyone's face or background. No text overlays.`;

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
        variantPrompt
      );

      return NextResponse.json({
        frameImageBase64: variantFrame,
        modelUsed: 'gemini-nano-banana-2.1',
      });
    }

    // PASSO BASE: invia fino a 4 foto reali di riferimento del Cast per mantenere la somiglianza 1:1
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
        ? `Characters present in this shot (matching the attached reference photos in order): ${characterNames.join(', ')}. Active speaker: ${targetSpeaker}.`
        : `Active speaker matching the attached reference photo: ${targetSpeaker}.`;

    const masterPrompt = `STRICT 1:1 PHOTOGRAPHIC IDENTITY LOCK (${orientationLabel}): Place the EXACT real person(s)/animal(s) from the attached reference photo(s) into this scene.
- CRITICAL: Preserve 100% of the exact real face, eye shape, nose, mouth, hair, beard/stubble, age, and natural skin texture from the reference photo(s). Do NOT replace them with generic AI faces or alter their likeness.
- Style: Authentic, unretouched real iPhone 16 Pro video frame, natural daylight/indoor lighting, realistic skin pores, zero CGI or plastic look.
- ${castNamesList}
- Framing & Scene: ${cameraAngle || 'Medium selfie shot'}. ${visualPromptEn}.
- Pose for Keyframe 0: ${targetSpeaker} is looking at the camera with a natural, realistic closed-mouth or gentle smile expression just before speaking. No text overlays, no watermarks.`;

    const [frame1, audioWavBase64] = await Promise.all([
      generateSingleNanoBananaFrame(ai, refParts, masterPrompt),
      (async (): Promise<string | null> => {
        if (!dialogueIta || !dialogueIta.trim()) return null;
        const cleanDialogue = dialogueIta
          .trim()
          .replace(/^["“«]+|["”»]+$/g, '')
          .trim();
        if (!cleanDialogue) return null;

        const voiceName = pickVoiceForSpeaker(speakerName, speakerDescriptor);
        // Priorità a gemini-2.5-pro-preview-tts con languageCode: 'it-IT' per dizione italiana madrelingua naturale e calda
        const ttsModels = [
          'gemini-2.5-pro-preview-tts',
          'gemini-3.8-flash-tts',
          'gemini-2.5-flash-preview-tts',
        ];
        for (const ttsModel of ttsModels) {
          try {
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
                speechConfig: {
                  languageCode: 'it-IT',
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName,
                    },
                  },
                },
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
      modelUsed: 'gemini-nano-banana-2.1',
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
