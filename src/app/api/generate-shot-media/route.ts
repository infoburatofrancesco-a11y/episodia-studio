import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Estende il timeout delle Serverless Functions su Vercel fino a 60 secondi
export const maxDuration = 60;

interface GenerateShotMediaBody {
  step?: 'base' | 'variant';
  baseFrameBase64?: string;
  variantType?: 'speaking' | 'reaction';
  visualPromptEn: string;
  dialogueIta?: string;
  speakerName?: string;
  speakerCategory?: 'human' | 'animal';
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

const VOICE_POOL = ['Puck', 'Kore', 'Aoede', 'Charon', 'Fenrir'];

function pickVoiceForSpeaker(speakerName?: string): string {
  if (!speakerName) return 'Puck';
  let hash = 0;
  for (let i = 0; i < speakerName.length; i++) {
    hash = (hash * 31 + speakerName.charCodeAt(i)) % 1000;
  }
  return VOICE_POOL[hash % VOICE_POOL.length];
}

async function generateSingleNanoBananaFrame(
  ai: GoogleGenAI,
  refParts: Array<{ inlineData: { mimeType: string; data: string } }>,
  promptText: string
): Promise<string | null> {
  const nanoBananaModels = [
    'gemini-3.1-flash-image',
    'gemini-nano-banana-2.1',
    'gemini-2.5-flash-image',
    'nano-banana-pro-preview',
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
      variantType = 'speaking',
      visualPromptEn,
      dialogueIta,
      speakerName,
      aspectRatio = '9:16',
      referenceImagesBase64 = [],
    } = body;

    const ai = new GoogleGenAI({ apiKey });

    const orientationLabel =
      aspectRatio === '9:16'
        ? 'vertical 9:16 portrait smartphone social format'
        : 'horizontal 16:9 widescreen cinematic format';

    // PASSO VARIANTE: modifica il Frame 1 già generato mantenendo lo stesso identico sfondo (1 sola chiamata veloce < 8s)
    if (step === 'variant' && baseFrameBase64) {
      const parsedBase = parseDataUrl(baseFrameBase64);
      if (!parsedBase) {
        return NextResponse.json({ frameImageBase64: null });
      }
      const variantPrompt =
        variantType === 'speaking'
          ? `Create a photorealistic cinematic TV series frame in ${orientationLabel} continuing this exact scene in the same room and lighting with the exact same character identity and clothing: dynamic medium-close shot of the character mid-action speaking expressively with an animated hand gesture and natural movement. No text overlays.`
          : `Create a photorealistic cinematic TV series frame in ${orientationLabel} continuing this exact scene in the same room and lighting with the exact same character identity and clothing: expressive close-up reaction shot of the character delivering the final facial expression or smile at the end of their scene. No text overlays.`;

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

    // PASSO BASE: 1 sola chiamata immagine + 1 chiamata TTS in parallelo (< 8 secondi totali, mai timeout su Vercel!)
    const refParts: Array<{ inlineData: { mimeType: string; data: string } }> =
      [];
    for (const refImg of referenceImagesBase64.slice(0, 1)) {
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

    const masterPrompt = `Generate a photorealistic cinematic TV series frame in ${orientationLabel}. Keep the exact face and identity of the reference character photo. Scene: ${visualPromptEn}. Natural posture, expressive face, looking at camera. No text overlays, no watermarks.`;

    const [frame1, audioWavBase64] = await Promise.all([
      generateSingleNanoBananaFrame(ai, refParts, masterPrompt),
      (async (): Promise<string | null> => {
        if (!dialogueIta || !dialogueIta.trim()) return null;
        // Puliamo eventuali virgolette esterne così il TTS legge ESCLUSIVAMENTE la battuta del personaggio!
        const cleanDialogue = dialogueIta
          .trim()
          .replace(/^["“«]+|["”»]+$/g, '')
          .trim();
        if (!cleanDialogue) return null;

        const voiceName = pickVoiceForSpeaker(speakerName);
        const ttsModels = [
          'gemini-3.8-flash-tts',
          'gemini-2.5-flash-preview-tts',
          'gemini-3.8-flash-lite-tts',
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
