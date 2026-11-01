import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

interface GenerateShotMediaBody {
  visualPromptEn: string;
  dialogueIta?: string;
  speakerName?: string;
  speakerCategory?: 'human' | 'animal';
  aspectRatio?: '9:16' | '16:9';
  referenceImagesBase64?: string[];
  shotNumber?: number;
}

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
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
  wavHeader.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  wavHeader.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
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
  if (!speakerName) return 'Kore';
  let hash = 0;
  for (let i = 0; i < speakerName.length; i++) {
    hash = (hash * 31 + speakerName.charCodeAt(i)) % 1000;
  }
  return VOICE_POOL[hash % VOICE_POOL.length];
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
      visualPromptEn,
      dialogueIta,
      speakerName,
      aspectRatio = '9:16',
      referenceImagesBase64 = [],
    } = body;

    const ai = new GoogleGenAI({ apiKey });

    // 1. GENERAZIONE IMMAGINE SCENA COERENTE COL CAST (Gemini 3.1 Flash Image / 2.5 Flash Image)
    let frameImageBase64: string | null = null;
    const imageParts: Array<
      | { inlineData: { mimeType: string; data: string } }
      | { text: string }
    > = [];

    for (const refImg of referenceImagesBase64.slice(0, 4)) {
      const parsed = parseDataUrl(refImg);
      if (parsed) {
        imageParts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data,
          },
        });
      }
    }

    const orientationLabel =
      aspectRatio === '9:16'
        ? 'vertical 9:16 portrait smartphone social format'
        : 'horizontal 16:9 widescreen cinematic format';

    imageParts.push({
      text: `Generate a photorealistic cinematic TV series scene frame in ${orientationLabel}. Keep the exact facial features, hair, and identity of the reference character photo(s) provided. Scene description: ${visualPromptEn}. High quality lighting, expressive acting, no text overlays.`,
    });

    const imageModels = [
      'gemini-3.1-flash-image',
      'gemini-2.5-flash-image',
      'gemini-3-pro-image',
    ];

    for (const modelName of imageModels) {
      try {
        const imgRes = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: 'user', parts: imageParts }],
          config: {
            responseModalities: ['IMAGE', 'TEXT'],
          },
        });

        const parts = imgRes.candidates?.[0]?.content?.parts || [];
        for (const p of parts) {
          if (p.inlineData?.data && p.inlineData?.mimeType?.startsWith('image/')) {
            frameImageBase64 = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
            break;
          }
        }
        if (frameImageBase64) break;
      } catch (imgErr) {
        console.warn(`Fallback modello immagine (${modelName}):`, imgErr);
      }
    }

    // Se il modello immagine non restituisce un frame, usiamo la prima foto di riferimento del personaggio
    if (!frameImageBase64 && referenceImagesBase64.length > 0) {
      frameImageBase64 = referenceImagesBase64[0];
    }

    // 2. GENERAZIONE VOCE ITALIANA RECITATA (Gemini 3.8 Flash TTS / 2.5 Flash Preview TTS)
    let audioWavBase64: string | null = null;
    if (dialogueIta && dialogueIta.trim().length > 0) {
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
                    text: `Recita in italiano in modo espressivo, brillante e naturale questa battuta (massimo 5 secondi): "${dialogueIta.trim()}"`,
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
            const mime = audioPart.inlineData.mimeType || 'audio/L16;rate=24000';
            if (mime.includes('wav')) {
              audioWavBase64 = `data:audio/wav;base64,${audioPart.inlineData.data}`;
            } else {
              audioWavBase64 = pcm24kMonoToWavBase64(
                audioPart.inlineData.data,
                24000
              );
            }
            break;
          }
        } catch (ttsErr) {
          console.warn(`Fallback modello TTS (${ttsModel}):`, ttsErr);
        }
      }
    }

    return NextResponse.json({
      frameImageBase64,
      audioWavBase64,
    });
  } catch (error: unknown) {
    console.error('Errore in /api/generate-shot-media:', error);
    const msg =
      error instanceof Error
        ? error.message
        : 'Errore imprevisto durante la generazione multimediale dello shot.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
